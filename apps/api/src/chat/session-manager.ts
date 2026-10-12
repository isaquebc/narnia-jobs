import {
  buildPersona,
  cardUpdatedNote,
  clarifyContextNote,
  friendlyError,
  getCard,
  newId,
  type Repos,
  renderRecruiterPrompt,
  resolveChatSettings,
  resumeLostNote,
} from "@narnia-jobs/core";
import type { ChatEvent, ChatHandle, Provider, Usage } from "@narnia-jobs/providers";
import {
  type ChatCategory,
  type ChatSession,
  clip,
  contentTracingEnabled,
  nowUtc,
  type SpanHandle,
  startSpan,
} from "@narnia-jobs/shared";
import type { EventBus } from "../events";
import { NATIVE_TOOLS } from "../mcp/scopes";
import { pluginDir, readRecruiterTemplate, stripFrontmatter } from "../plugin";

export class SessionLimitError extends Error {
  constructor(
    readonly max: number,
    readonly live: ChatSession[],
  ) {
    super(`Limite de ${max} conversas abertas atingido`);
  }
}
export class SessionStateError extends Error {
  constructor(
    readonly code:
      | "session_not_found"
      | "turn_in_progress"
      | "session_archived"
      | "no_profile"
      | "budget_exhausted",
    message: string,
  ) {
    super(message);
  }
}

export interface SessionManagerDeps {
  repos: Repos;
  provider: Provider;
  bus: EventBus;
  /** URL do `/mcp` deste api, vista de dentro do container (o CLI é processo filho). */
  mcpUrl: string;
  token: string;
  /** Pasta do plugin; null = sem plugin (testes). Ausente = `pluginDir()` do api. */
  pluginDir?: string | null;
  /** Só o mock usa: como chamar o `/mcp` (nos testes, a própria app em memória). */
  mcpFetch?: typeof fetch;
  /** "Parar" sem result do CLI: depois deste tempo o processo é fechado e a conversa retoma (padrão 10 s). */
  interruptTimeoutMs?: number;
}

/** Texto acrescentado à resposta parcial guardada de um turno cortado. */
const INTERRUPTED_MARK = "_(resposta interrompida)_";
/** Mensagens do banco antepostas quando a retomada se perde. */
const RESUME_HISTORY_MAX = 12;
/** Erro de retomada: o transcript do provider não existe mais. */
const RESUME_LOST = /no conversation found|conversation .*not found|session .*not found/i;

interface Live {
  handle: ChatHandle;
  busy: boolean;
  turnIndex: number;
  text: string;
  toolCalls: Array<{ name: string; args: string; durationMs: number | null; isError: boolean }>;
  toolStarts: Map<string, { name: string; args: string; t0: number }>;
  /** F04/M5: span do turno em andamento (no-op sem NARNIA_OTEL_ENDPOINT). */
  span?: SpanHandle | undefined;
  /** Fechado pelo api (hibernar, arquivar, trocar): eventos tardios do processo são ignorados (auditoria B). */
  closed: boolean;
  /** "Parar" pedido: o próximo fim de turno (de qualquer tipo) fecha o turno como interrompido. */
  interrupting: boolean;
  interruptTimer?: NodeJS.Timeout | undefined;
  /** Próximo delta começa bloco de texto novo: vai com "\n\n" na frente. */
  needsBreak: boolean;
  /** Último `total_cost_usd` (acumulado da query) visto neste processo; null antes do 1º turno. */
  lastTotal: number | null;
  /** Custo já registrado da sessão ao abrir: com `resume`, o 1º total do SDK já o inclui. */
  baseCost: number;
  resumed: boolean;
  inited: boolean;
  /** Já reaberto sem `resume` depois de uma retomada perdida (não tenta de novo). */
  recovered: boolean;
  /** Texto enviado no turno corrente (com as notas), para reenviar se a retomada se perder. */
  pendingText: string;
  /** Categoria com que o processo foi aberto: mudou no banco = reabrir para o CLI ver as tools novas. */
  category: ChatCategory;
}

/**
 * Sessões de chat vivas no processo do api (F04-10, §2.5): uma `ChatHandle` por sessão, teto de sessões vivas com 409
 * e escolha (F04-3), hibernação por inatividade e no boot com retomada por `resume` (F04-4), nota de cartão atualizado
 * (F04-1), persistência de mensagens e uso por turno, eventos `chat.*` no `/ws` (F04-13).
 */
export class SessionManager {
  private readonly live = new Map<string, Live>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(private readonly deps: SessionManagerDeps) {}

  private get repos() {
    return this.deps.repos;
  }

  /** Reinício do api: os processos do CLI morreram; sessões "live" passam a hibernadas (o `resume` retoma). */
  hibernateAllOnBoot(): number {
    const live = this.repos.chatSessions.list({ states: ["live"] });
    for (const s of live) this.repos.chatSessions.setState(s.id, "hibernated");
    return live.length;
  }

  private ensureCapacity(exceptId?: string) {
    const max = resolveChatSettings(this.repos.settings).maxLiveSessions;
    const live = this.repos.chatSessions
      .list({ states: ["live"] })
      .filter((s) => s.id !== exceptId);
    if (live.length >= max) throw new SessionLimitError(max, live);
  }

  get(id: string): ChatSession {
    const s = this.repos.chatSessions.get(id);
    if (!s) throw new SessionStateError("session_not_found", "Conversa não encontrada");
    return this.withBusy(s);
  }

  /** Acrescenta `busy` (turno em andamento neste processo) para a web derivar o "pensando" (auditoria B). */
  withBusy(s: ChatSession): ChatSession {
    return { ...s, busy: this.live.get(s.id)?.busy === true };
  }

  create(input: {
    profileId?: string;
    category: ChatCategory;
    model?: string;
    title?: string;
    ingestionRunId?: string | null;
  }): ChatSession {
    const profileId = input.profileId ?? this.repos.profiles.active()?.id;
    if (!profileId)
      throw new SessionStateError("no_profile", "Nenhum perfil ativo: conclua o primeiro uso.");
    this.ensureCapacity();
    const settings = resolveChatSettings(this.repos.settings);
    const s = this.repos.chatSessions.create({
      profileId,
      category: input.category,
      title: input.title ?? "Nova conversa",
      provider: this.deps.provider.id,
      model: input.model ?? settings.defaultModel,
      ingestionRunId: input.ingestionRunId ?? null,
    });
    this.repos.chatSessions.setState(s.id, "live");
    this.emitState(s.id, "live");
    return this.get(s.id);
  }

  private open(session: ChatSession): Live {
    const profile = this.repos.profiles.get(session.profileId);
    if (!profile)
      throw new SessionStateError("no_profile", "O perfil desta conversa não existe mais.");
    const card = getCard(this.repos, profile.id);
    // o prompt vai sem snapshot (renderizado a cada abertura) com o cartão atual: a nota de cartão não se repete
    this.repos.chatSessions.setCardHash(session.id, card.hash);
    const settings = resolveChatSettings(this.repos.settings);
    // teto por sessão: o SDK conta só o gasto desde esta abertura, então o processo recebe o que resta
    const budget =
      settings.maxBudgetUsd === null
        ? null
        : Math.max(0, settings.maxBudgetUsd - session.costUsdEst);
    const plugin = this.deps.pluginDir === undefined ? pluginDir() : this.deps.pluginDir;
    const handle = this.deps.provider.openChat({
      systemPrompt: renderRecruiterPrompt(stripFrontmatter(readRecruiterTemplate()), {
        persona: buildPersona(profile),
        card: card.text,
        trustedDomains: this.repos.trustedDomains.list(),
      }),
      model: session.model,
      resume: session.providerSessionId,
      maxTurns: settings.maxTurns,
      maxBudgetUsd: budget,
      mcp: {
        url: this.deps.mcpUrl,
        headers: { Authorization: `Bearer ${this.deps.token}`, "X-Narnia-Session": session.id },
      },
      pluginDir: plugin,
      tools: NATIVE_TOOLS[session.category],
      canFetch: (url) => this.canFetch(url),
      env: { NARNIA_SESSION_HAS_CARD: "1" },
      category: session.category,
      ingestionRunId: session.ingestionRunId,
      ...(this.deps.mcpFetch ? { fetch: this.deps.mcpFetch } : {}),
    });
    const entry: Live = {
      handle,
      busy: false,
      turnIndex: 0,
      text: "",
      toolCalls: [],
      toolStarts: new Map(),
      closed: false,
      interrupting: false,
      needsBreak: false,
      lastTotal: null,
      baseCost: session.costUsdEst,
      resumed: Boolean(session.providerSessionId),
      inited: false,
      recovered: false,
      pendingText: "",
      category: session.category,
    };
    this.live.set(session.id, entry);
    void this.consume(session.id, entry);
    return entry;
  }

  /** Envia uma mensagem; acorda a sessão hibernada (com `resume`) e antepõe as notas de contexto quando couber. */
  send(id: string, text: string): { turnIndex: number } {
    const session = this.get(id);
    if (session.state === "archived")
      throw new SessionStateError(
        "session_archived",
        "Conversa arquivada: desarquive para continuar.",
      );
    const settings = resolveChatSettings(this.repos.settings);
    if (settings.maxBudgetUsd !== null && session.costUsdEst >= settings.maxBudgetUsd) {
      this.deps.bus.emit({ type: "chat.limit", sessionId: id, reason: "max_budget" });
      throw new SessionStateError(
        "budget_exhausted",
        "Teto de custo desta conversa atingido: aumente em Configurações › Chat ou comece outra conversa.",
      );
    }
    let entry = this.live.get(id);
    if (entry?.busy)
      throw new SessionStateError(
        "turn_in_progress",
        "Aguarde a resposta atual ou pare antes de enviar outra.",
      );
    if (!entry) {
      if (session.state !== "live") this.ensureCapacity(id);
      entry = this.open(session);
      if (session.state !== "live") {
        this.repos.chatSessions.setState(id, "live");
        this.emitState(id, "live");
      }
    }
    const turnIndex = this.repos.chatMessages.nextTurnIndex(id);
    const notes: string[] = [];
    if (session.category === "clarify" && session.ingestionRunId && turnIndex === 0)
      notes.push(clarifyContextNote(session.ingestionRunId));
    const current = this.repos.chatSessions.get(id);
    const card = getCard(this.repos, session.profileId);
    if (current?.cardHash && current.cardHash !== card.hash) {
      notes.push(cardUpdatedNote(card.text));
      this.repos.chatSessions.setCardHash(id, card.hash);
      this.repos.chatMessages.add({
        sessionId: id,
        turnIndex,
        role: "system_note",
        contentMd: "Cartão do perfil atualizado",
        toolCalls: [],
        usage: null,
      });
    }
    this.repos.chatMessages.add({
      sessionId: id,
      turnIndex,
      role: "user",
      contentMd: text,
      toolCalls: [],
      usage: null,
    });
    this.repos.chatSessions.touch(id);
    const span = startSpan("chat.turn", {
      "openinference.span.kind": "CHAIN",
      "narnia.session_id": id,
      "narnia.profile_id": session.profileId,
      "narnia.category": session.category,
      "narnia.turn_index": turnIndex,
      "llm.model_name": current?.model ?? session.model,
      ...(contentTracingEnabled() ? { "input.value": clip(text) } : {}),
    });
    const full = [...notes, text].join("\n\n");
    Object.assign(entry, {
      busy: true,
      turnIndex,
      text: "",
      toolCalls: [],
      toolStarts: new Map(),
      span,
      interrupting: false,
      needsBreak: false,
      pendingText: full,
    });
    entry.handle.send(full);
    return { turnIndex };
  }

  /** O processo desta entrada ainda é o da sessão? Eventos de processo fechado ou substituído são ignorados. */
  private isCurrent(id: string, entry: Live): boolean {
    return !entry.closed && this.live.get(id) === entry;
  }

  private async consume(id: string, entry: Live) {
    try {
      for await (const e of entry.handle.events) {
        if (!this.isCurrent(id, entry)) return;
        this.handle(id, entry, e);
      }
    } catch (err) {
      if (this.isCurrent(id, entry)) this.onError(id, entry, { message: (err as Error).message });
      return;
    }
    // o stream acabou sem erro: o processo do CLI saiu; a próxima mensagem reabre com `resume`
    if (!this.isCurrent(id, entry)) return;
    if (entry.busy && entry.interrupting) {
      this.drop(id, entry);
      this.finishInterrupted(id, entry);
    } else if (entry.busy)
      this.fail(
        id,
        entry,
        "O processo do recrutador encerrou antes de responder. Envie de novo para retomar.",
      );
    else this.drop(id, entry);
  }

  private handle(id: string, entry: Live, e: ChatEvent) {
    const { bus } = this.deps;
    switch (e.type) {
      case "init":
        entry.inited = true;
        this.repos.chatSessions.setProviderSessionId(id, e.providerSessionId);
        return;
      case "text_break":
        if (entry.text) entry.needsBreak = true;
        return;
      case "delta": {
        const text = entry.needsBreak ? `\n\n${e.text}` : e.text;
        entry.needsBreak = false;
        entry.text += text;
        bus.emit({ type: "chat.delta", sessionId: id, text });
        return;
      }
      case "tool_start":
        entry.toolStarts.set(e.id, { name: e.name, args: e.args, t0: Date.now() });
        bus.emit({ type: "chat.tool", sessionId: id, name: e.name, phase: "start" });
        return;
      case "tool_end": {
        const start = entry.toolStarts.get(e.id);
        const durationMs = start ? Date.now() - start.t0 : null;
        const name = start?.name ?? "tool";
        entry.toolCalls.push({ name, args: start?.args ?? "{}", durationMs, isError: e.isError });
        bus.emit({
          type: "chat.tool",
          sessionId: id,
          name,
          phase: e.isError ? "error" : "end",
          ...(durationMs !== null ? { durationMs } : {}),
        });
        const s = this.repos.chatSessions.get(id);
        if (name === "ingest_propose" && s?.ingestionRunId) {
          const run = this.repos.ingestionRuns.get(s.ingestionRunId);
          if (run) bus.emit({ type: "ingestion.updated", runId: run.id, status: run.status });
        }
        if (name === "session_set_category" && s && s.category !== entry.category)
          bus.emit({
            type: "chat.session_updated",
            sessionId: id,
            state: s.state,
            category: s.category,
          });
        return;
      }
      case "turn_end":
      case "limit": {
        if (entry.interrupting || (e.type === "turn_end" && e.interrupted)) {
          this.finishInterrupted(id, entry, e);
          return;
        }
        const s = this.repos.chatSessions.get(id);
        if (!s) return;
        const text = entry.text || (e.type === "turn_end" ? e.text : "");
        this.repos.chatMessages.add({
          sessionId: id,
          turnIndex: entry.turnIndex,
          role: "assistant",
          contentMd: text,
          toolCalls: entry.toolCalls,
          usage: { inputTokens: e.usage.inputTokens, outputTokens: e.usage.outputTokens },
        });
        const cost = this.recordUsage(
          id,
          entry,
          e.usage,
          e.costUsd,
          e.type === "turn_end" ? e.providerSessionId : null,
        );
        entry.span?.setAttributes({
          "llm.token_count.prompt": e.usage.inputTokens,
          "llm.token_count.completion": e.usage.outputTokens,
          "narnia.cost_usd": cost,
          "narnia.tool_calls": entry.toolCalls.length,
          ...(e.type === "limit" ? { "narnia.limit": e.reason } : {}),
          ...(contentTracingEnabled() ? { "output.value": clip(text) } : {}),
        });
        entry.span?.end();
        entry.span = undefined;
        entry.busy = false;
        if (e.type === "limit") bus.emit({ type: "chat.limit", sessionId: id, reason: e.reason });
        bus.emit({
          type: "chat.turn_end",
          sessionId: id,
          turnIndex: entry.turnIndex,
          usage: { inputTokens: e.usage.inputTokens, outputTokens: e.usage.outputTokens },
        });
        this.reopenIfCategoryChanged(id, entry);
        return;
      }
      case "error":
        this.onError(id, entry, e);
        return;
    }
  }

  /**
   * Custo do turno = delta do total acumulado do SDK (auditoria B): o `total_cost_usd` de cada result é o total da
   * query() até ali; com `resume`, o 1º total já traz os turnos anteriores (já registrados); total menor que o último
   * = `/clear`, recomeça. Grava `usage_event` e soma na sessão; devolve o custo do turno.
   */
  private recordUsage(
    id: string,
    entry: Live,
    usage: Usage,
    total: number,
    providerSessionId: string | null,
  ): number {
    const s = this.repos.chatSessions.get(id);
    if (!s) return 0;
    let delta: number;
    if (entry.lastTotal === null) delta = entry.resumed ? total - entry.baseCost : total;
    else if (total < entry.lastTotal) delta = total;
    else delta = total - entry.lastTotal;
    entry.lastTotal = total;
    const cost = Math.max(0, delta);
    this.repos.usageEvents.insertTurn(
      {
        id: newId(),
        ts: nowUtc(),
        origin: "narnia",
        category: `chat.${s.category}`,
        jobId: null,
        sessionId: id,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheRead: usage.cacheReadTokens,
        cacheWrite: usage.cacheWriteTokens,
        costUsdEst: cost,
      },
      {
        providerSessionId: providerSessionId ?? s.providerSessionId ?? `local-${id}`,
        turnIndex: entry.turnIndex,
      },
    );
    this.repos.chatSessions.addUsage(id, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: cost,
    });
    return cost;
  }

  /**
   * Turno cortado ("Parar", hibernar, arquivar, tempo de segurança): guarda a resposta parcial marcada, registra o
   * uso quando o CLI mandou, encerra o span e avisa a web com `interrupted` (auditoria B). Nunca vai para "erro".
   */
  private finishInterrupted(
    id: string,
    entry: Live,
    e?: { usage?: Usage | undefined; costUsd?: number | undefined },
  ) {
    if (entry.interruptTimer) clearTimeout(entry.interruptTimer);
    entry.interruptTimer = undefined;
    const wasBusy = entry.busy;
    entry.interrupting = false;
    entry.busy = false;
    if (!wasBusy) return;
    const session = this.repos.chatSessions.get(id);
    const partial = entry.text.trim();
    if (session && (partial || entry.toolCalls.length > 0))
      this.repos.chatMessages.add({
        sessionId: id,
        turnIndex: entry.turnIndex,
        role: "assistant",
        contentMd: partial ? `${partial}\n\n${INTERRUPTED_MARK}` : INTERRUPTED_MARK,
        toolCalls: entry.toolCalls,
        usage: e?.usage
          ? { inputTokens: e.usage.inputTokens, outputTokens: e.usage.outputTokens }
          : null,
      });
    if (session && e?.usage && typeof e.costUsd === "number")
      this.recordUsage(id, entry, e.usage, e.costUsd, null);
    entry.span?.setAttributes({ "narnia.interrupted": true });
    entry.span?.end();
    entry.span = undefined;
    this.deps.bus.emit({
      type: "chat.turn_end",
      sessionId: id,
      turnIndex: entry.turnIndex,
      usage: {
        inputTokens: e?.usage?.inputTokens ?? 0,
        outputTokens: e?.usage?.outputTokens ?? 0,
      },
      interrupted: true,
    });
    if (!entry.closed) this.reopenIfCategoryChanged(id, entry);
  }

  /** Categoria mudou enquanto o processo vivia: fecha (sem turno ativo) para a próxima mensagem reabrir com as tools novas. */
  private reopenIfCategoryChanged(id: string, entry: Live) {
    const s = this.repos.chatSessions.get(id);
    if (s && s.category !== entry.category && !entry.busy && this.isCurrent(id, entry))
      this.closeHandle(id);
  }

  /** Erro de turno ou do processo: no "Parar" fecha como interrompido; retomada perdida reabre sem `resume`. */
  private onError(
    id: string,
    entry: Live,
    e: { message: string; usage?: Usage | undefined; costUsd?: number | undefined },
  ) {
    if (entry.interrupting) {
      this.finishInterrupted(id, entry, e);
      return;
    }
    if (
      entry.busy &&
      entry.resumed &&
      !entry.recovered &&
      (!entry.inited || RESUME_LOST.test(e.message))
    ) {
      this.recoverLostResume(id, entry);
      return;
    }
    if (e.usage && typeof e.costUsd === "number" && (e.usage.inputTokens > 0 || e.costUsd > 0))
      this.recordUsage(id, entry, e.usage, e.costUsd, null);
    this.fail(id, entry, e.message);
  }

  /**
   * Retomada perdida (auditoria B): o transcript do provider não existe mais. Esquece o id, reabre sem `resume` e
   * reenvia a mensagem do turno com as mensagens recentes do banco antepostas; fica uma nota no histórico.
   */
  private recoverLostResume(id: string, entry: Live) {
    entry.closed = true;
    this.live.delete(id);
    entry.handle.close();
    this.repos.chatSessions.setProviderSessionId(id, null);
    const history = this.repos.chatMessages
      .list(id, { limit: 200 })
      .filter((m) => m.turnIndex < entry.turnIndex && (m.role === "user" || m.role === "assistant"))
      .slice(-RESUME_HISTORY_MAX)
      .map((m) => ({ role: m.role as "user" | "assistant", text: m.contentMd }));
    this.repos.chatMessages.add({
      sessionId: id,
      turnIndex: entry.turnIndex,
      role: "system_note",
      contentMd:
        "Histórico do recrutador não pôde ser retomado: conversa reaberta com as mensagens recentes",
      toolCalls: [],
      usage: null,
    });
    const fresh = this.open(this.get(id));
    const text = history.length
      ? `${resumeLostNote(history)}\n\n${entry.pendingText}`
      : entry.pendingText;
    Object.assign(fresh, {
      busy: true,
      turnIndex: entry.turnIndex,
      span: entry.span,
      recovered: true,
      pendingText: entry.pendingText,
    });
    fresh.handle.send(text);
  }

  /** Tira do mapa um processo que saiu sem turno ativo: a próxima mensagem reabre com `resume`. */
  private drop(id: string, entry: Live) {
    entry.closed = true;
    this.live.delete(id);
    entry.handle.close();
  }

  private fail(id: string, entry: Live, message: string) {
    const f = friendlyError(message);
    if (entry.interruptTimer) clearTimeout(entry.interruptTimer);
    entry.span?.recordError(new Error(message));
    entry.span?.end();
    entry.span = undefined;
    entry.busy = false;
    entry.closed = true;
    entry.handle.close();
    this.live.delete(id);
    if (this.repos.chatSessions.get(id)) {
      this.repos.chatSessions.setState(id, "error");
      this.emitState(id, "error");
    }
    this.deps.bus.emit({ type: "chat.error", sessionId: id, error: message, errorKey: f.key });
  }

  /**
   * Leitura web (WebFetch) da conversa: só http(s) de domínio confiável, com a lista e a preferência lidas na hora
   * (auditoria A). Com `research.require_trusted` desligado pelo usuário, qualquer http(s).
   */
  private canFetch(url: string): boolean {
    let host: string;
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return false;
      host = u.hostname;
    } catch {
      return false;
    }
    if (!resolveChatSettings(this.repos.settings).requireTrustedResearch) return true;
    return this.repos.trustedDomains.match(host) !== null;
  }

  private emitState(id: string, state: ChatSession["state"], category?: ChatCategory) {
    this.deps.bus.emit({
      type: "chat.session_updated",
      sessionId: id,
      state,
      ...(category ? { category } : {}),
    });
  }

  /**
   * Fecha o processo da sessão. Com turno ativo, fecha o turno como interrompido (a web sai do "pensando");
   * `persist: false` (apagar, desligar) não grava a resposta parcial.
   */
  private closeHandle(id: string, persist = true) {
    const entry = this.live.get(id);
    if (!entry) return;
    entry.closed = true;
    this.live.delete(id);
    if (entry.busy) {
      if (persist) this.finishInterrupted(id, entry);
      else {
        if (entry.interruptTimer) clearTimeout(entry.interruptTimer);
        entry.span?.end();
        entry.span = undefined;
        entry.busy = false;
      }
    }
    entry.handle.close();
  }

  /**
   * "Parar" (auditoria B): o turno segue ocupado até o CLI mandar o result do turno cortado (qualquer tipo fecha como
   * interrompido); sem result no tempo de segurança, o processo é fechado e a próxima mensagem retoma.
   */
  async interrupt(id: string): Promise<void> {
    this.get(id);
    const entry = this.live.get(id);
    if (!entry?.busy || entry.interrupting) return;
    entry.interrupting = true;
    entry.interruptTimer = setTimeout(() => {
      if (this.isCurrent(id, entry) && entry.interrupting) this.closeHandle(id);
    }, this.deps.interruptTimeoutMs ?? 10_000);
    entry.interruptTimer.unref?.();
    try {
      await entry.handle.interrupt();
    } catch {
      // processo já saiu: o fim do stream ou o tempo de segurança fecham o turno
    }
  }

  hibernate(id: string): ChatSession {
    const s = this.get(id);
    this.closeHandle(id);
    if (s.state === "live" || s.state === "error") {
      this.repos.chatSessions.setState(id, "hibernated");
      this.emitState(id, "hibernated");
    }
    return this.get(id);
  }

  wake(id: string): ChatSession {
    const s = this.get(id);
    if (s.state === "archived")
      throw new SessionStateError(
        "session_archived",
        "Conversa arquivada: desarquive para continuar.",
      );
    if (s.state !== "live") {
      this.ensureCapacity(id);
      this.repos.chatSessions.setState(id, "live");
      this.emitState(id, "live");
    }
    return this.get(id);
  }

  async patch(
    id: string,
    p: {
      title?: string | undefined;
      category?: ChatCategory | undefined;
      model?: string | undefined;
      archived?: boolean | undefined;
    },
  ): Promise<ChatSession> {
    const s = this.get(id);
    if (p.title) this.repos.chatSessions.setTitle(id, p.title);
    if (p.category && p.category !== s.category) {
      this.repos.chatSessions.setCategory(id, p.category);
      // o CLI guarda o tools/list da conexão: sem turno ativo, reabre já; com turno, ao fim dele
      const entry = this.live.get(id);
      if (entry && !entry.busy) this.closeHandle(id);
      this.emitState(id, s.state, p.category);
    }
    if (p.model && p.model !== s.model) {
      this.repos.chatSessions.setModel(id, p.model);
      await this.live.get(id)?.handle.setModel(p.model);
    }
    if (p.archived === true && s.state !== "archived") {
      this.closeHandle(id);
      this.repos.chatSessions.setState(id, "archived");
      this.emitState(id, "archived");
    }
    if (p.archived === false && s.state === "archived") {
      this.repos.chatSessions.setState(id, "hibernated");
      this.emitState(id, "hibernated");
    }
    return this.get(id);
  }

  remove(id: string): void {
    this.get(id);
    this.closeHandle(id, false);
    this.repos.chatSessions.remove(id);
  }

  /** Hiberna as vivas sem atividade há mais de `chat.hibernate_after_min` (F04-4). Devolve quantas hibernou. */
  sweep(nowMs = Date.now()): number {
    const limitMs = resolveChatSettings(this.repos.settings).hibernateAfterMin * 60_000;
    let n = 0;
    for (const s of this.repos.chatSessions.list({ states: ["live"] })) {
      if (this.live.get(s.id)?.busy) continue;
      if (nowMs - Date.parse(s.lastActivityAt) > limitMs) {
        this.hibernate(s.id);
        n++;
      }
    }
    return n;
  }

  startSweep(intervalMs = 60_000): void {
    this.sweeper ??= setInterval(() => this.sweep(), intervalMs);
    this.sweeper.unref();
  }

  closeAll(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    for (const id of [...this.live.keys()]) this.closeHandle(id, false);
  }
}
