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
} from "@narnia-jobs/core";
import type { ChatEvent, ChatHandle, Provider } from "@narnia-jobs/providers";
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
import { pluginDir, readRecruiterTemplate, stripFrontmatter } from "../plugin";

/** Tools nativas do CLI por categoria de sessão (F04-2): pesquisa web só onde faz sentido. */
const NATIVE_TOOLS: Record<ChatCategory, string[]> = {
  career: ["WebSearch", "WebFetch"],
  ingest: [],
  clarify: [],
  interview: [],
};

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
    readonly code: "session_not_found" | "turn_in_progress" | "session_archived" | "no_profile",
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
}

interface Live {
  handle: ChatHandle;
  busy: boolean;
  turnIndex: number;
  text: string;
  toolCalls: Array<{ name: string; args: string; durationMs: number | null; isError: boolean }>;
  toolStarts: Map<string, { name: string; args: string; t0: number }>;
  /** F04/M5: span do turno em andamento (no-op sem NARNIA_OTEL_ENDPOINT). */
  span?: SpanHandle | undefined;
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
    return s;
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
    if (!session.cardHash) this.repos.chatSessions.setCardHash(session.id, card.hash);
    const settings = resolveChatSettings(this.repos.settings);
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
      maxBudgetUsd: settings.maxBudgetUsd,
      mcp: {
        url: this.deps.mcpUrl,
        headers: { Authorization: `Bearer ${this.deps.token}`, "X-Narnia-Session": session.id },
      },
      pluginDir: plugin,
      tools: NATIVE_TOOLS[session.category],
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
    Object.assign(entry, {
      busy: true,
      turnIndex,
      text: "",
      toolCalls: [],
      toolStarts: new Map(),
      span,
    });
    entry.handle.send([...notes, text].join("\n\n"));
    return { turnIndex };
  }

  private async consume(id: string, entry: Live) {
    try {
      for await (const e of entry.handle.events) this.handle(id, entry, e);
    } catch (err) {
      this.fail(id, entry, (err as Error).message);
    }
  }

  private handle(id: string, entry: Live, e: ChatEvent) {
    const { bus } = this.deps;
    switch (e.type) {
      case "init":
        this.repos.chatSessions.setProviderSessionId(id, e.providerSessionId);
        return;
      case "delta":
        entry.text += e.text;
        bus.emit({ type: "chat.delta", sessionId: id, text: e.text });
        return;
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
        return;
      }
      case "turn_end":
      case "limit": {
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
        this.repos.usageEvents.insertTurn(
          {
            id: newId(),
            ts: nowUtc(),
            origin: "narnia",
            category: `chat.${s.category}`,
            jobId: null,
            sessionId: id,
            model: e.usage.model,
            inputTokens: e.usage.inputTokens,
            outputTokens: e.usage.outputTokens,
            cacheRead: e.usage.cacheReadTokens,
            cacheWrite: e.usage.cacheWriteTokens,
            costUsdEst: e.costUsd,
          },
          {
            providerSessionId:
              (e.type === "turn_end" ? e.providerSessionId : null) ??
              s.providerSessionId ??
              `local-${id}`,
            turnIndex: entry.turnIndex,
          },
        );
        this.repos.chatSessions.addUsage(id, {
          inputTokens: e.usage.inputTokens,
          outputTokens: e.usage.outputTokens,
          costUsd: e.costUsd,
        });
        entry.span?.setAttributes({
          "llm.token_count.prompt": e.usage.inputTokens,
          "llm.token_count.completion": e.usage.outputTokens,
          "narnia.cost_usd": e.costUsd,
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
        return;
      }
      case "error":
        this.fail(id, entry, e.message);
        return;
    }
  }

  private fail(id: string, entry: Live, message: string) {
    const f = friendlyError(message);
    entry.span?.recordError(new Error(message));
    entry.span?.end();
    entry.span = undefined;
    entry.busy = false;
    entry.handle.close();
    this.live.delete(id);
    if (this.repos.chatSessions.get(id)) {
      this.repos.chatSessions.setState(id, "error");
      this.emitState(id, "error");
    }
    this.deps.bus.emit({ type: "chat.error", sessionId: id, error: message, errorKey: f.key });
  }

  private emitState(id: string, state: ChatSession["state"]) {
    this.deps.bus.emit({ type: "chat.session_updated", sessionId: id, state });
  }

  private closeHandle(id: string) {
    const entry = this.live.get(id);
    if (!entry) return;
    entry.handle.close();
    this.live.delete(id);
  }

  async interrupt(id: string): Promise<void> {
    this.get(id);
    const entry = this.live.get(id);
    if (!entry) return;
    await entry.handle.interrupt();
    entry.busy = false;
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
    if (p.category) this.repos.chatSessions.setCategory(id, p.category);
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
    this.closeHandle(id);
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
    for (const id of [...this.live.keys()]) this.closeHandle(id);
  }
}
