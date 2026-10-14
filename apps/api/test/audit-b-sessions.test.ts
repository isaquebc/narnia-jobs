import { CHAT_SETTING_KEYS, seedFixture } from "@narnia-jobs/core";
import {
  type ChatEvent,
  type ChatHandle,
  type ChatOpenOptions,
  createAsyncQueue,
  MockProvider,
  type Usage,
} from "@narnia-jobs/providers";
import type { AnyWsEvent } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * Auditoria pós-F04 · bloco B (2026-10-12): comportamento do `SessionManager` com o Claude real. O provider é
 * roteirizado: cada `openChat` devolve um handle cujos eventos o teste empurra, como o CLI faria.
 */

interface Scripted {
  opts: ChatOpenOptions;
  sent: string[];
  interrupts: number;
  closed: boolean;
  push(e: ChatEvent): void;
  end(): void;
}

class ScriptedProvider extends MockProvider {
  handles: Scripted[] = [];
  override openChat(opts: ChatOpenOptions): ChatHandle {
    const q = createAsyncQueue<ChatEvent>();
    const h: Scripted = {
      opts,
      sent: [],
      interrupts: 0,
      closed: false,
      push: (e) => q.push(e),
      end: () => q.end(),
    };
    this.handles.push(h);
    return {
      send: (text) => h.sent.push(text),
      events: q.iterable,
      interrupt: async () => {
        h.interrupts++;
      },
      setModel: async () => undefined,
      // como o CLI real: fechar não garante silêncio; o processo ainda pode emitir (erro de abort) depois
      close: () => {
        h.closed = true;
      },
    };
  }
  last(): Scripted {
    return this.handles.at(-1) as Scripted;
  }
}

const usage = (model = "sonnet"): Usage => ({
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  model,
});
const endTurn = (costUsd: number, extra: Partial<Extract<ChatEvent, { type: "turn_end" }>> = {}) =>
  ({
    type: "turn_end",
    text: "",
    providerSessionId: "sdk-1",
    costUsd,
    usage: usage(),
    ...extra,
  }) as ChatEvent;

const tick = () => new Promise((r) => setTimeout(r, 15));
async function until(pred: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("condição não chegou");
    await tick();
  }
}
const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("auditoria B · SessionManager com o Claude real", () => {
  let t: TestApp;
  let p: ScriptedProvider;
  const of = (type: AnyWsEvent["type"], sid: string) =>
    t.events.filter((e) => e.type === type && "sessionId" in e && e.sessionId === sid);

  function setup(opts: { interruptTimeoutMs?: number } = {}) {
    p = new ScriptedProvider();
    t = makeTestApp({ provider: p, ...opts });
    const ids = seedFixture(t.repos, "engineer");
    const s = t.sessions.create({ category: "career", profileId: ids.profileId });
    return { sid: s.id, profileId: ids.profileId };
  }
  async function turn(sid: string, text: string, ev: ChatEvent[]) {
    const before = of("chat.turn_end", sid).length + of("chat.error", sid).length;
    t.sessions.send(sid, text);
    for (const e of ev) p.last().push(e);
    await until(() => of("chat.turn_end", sid).length + of("chat.error", sid).length > before);
  }
  afterEach(() => {
    t?.sessions.closeAll();
    t?.cleanup();
  });

  it("custo: o total acumulado do SDK vira delta por turno (0,10/0,20/0,30 → 0,30)", async () => {
    const { sid } = setup();
    p.handles.length = 0;
    await turn(sid, "a", [{ type: "init", providerSessionId: "sdk-1" }, endTurn(0.1)]);
    await turn(sid, "b", [endTurn(0.2)]);
    await turn(sid, "c", [endTurn(0.3)]);
    expect(t.repos.chatSessions.get(sid)?.costUsdEst).toBeCloseTo(0.3, 6);
    const costs = t.repos.usageEvents
      .list()
      .filter((u) => u.sessionId === sid && u.category !== "chat.title")
      .map((u) => u.costUsdEst);
    expect(costs.map((c) => Number(c.toFixed(6)))).toEqual([0.1, 0.1, 0.1]);
  });

  it("custo após resume: o primeiro total já traz os turnos anteriores; /clear (total menor) recomeça", async () => {
    const { sid } = setup();
    await turn(sid, "a", [{ type: "init", providerSessionId: "sdk-1" }, endTurn(0.3)]);
    t.sessions.hibernate(sid);
    await turn(sid, "b", [{ type: "init", providerSessionId: "sdk-1" }, endTurn(0.4)]);
    expect(p.last().opts.resume).toBe("sdk-1");
    expect(t.repos.chatSessions.get(sid)?.costUsdEst).toBeCloseTo(0.4, 6);
    await turn(sid, "c", [endTurn(0.05)]);
    expect(t.repos.chatSessions.get(sid)?.costUsdEst).toBeCloseTo(0.45, 6);
  });

  it("erro de API que chega como turno (is_error): sem mensagem do recrutador, chat.error amigável", async () => {
    const { sid } = setup();
    await turn(sid, "oi", [
      { type: "init", providerSessionId: "sdk-1" },
      {
        type: "error",
        message: "Failed to authenticate: OAuth session expired and could not be refreshed",
        usage: usage(),
        costUsd: 0,
      },
    ]);
    const msgs = t.repos.chatMessages.list(sid);
    expect(msgs.map((m) => m.role)).toEqual(["user"]);
    expect(of("chat.error", sid)[0]).toMatchObject({ errorKey: "error.auth_expired" });
  });

  it("Parar: o turno segue ocupado até o result; o result de erro do turno cortado fecha como interrompido", async () => {
    const { sid } = setup();
    t.sessions.send(sid, "conte tudo");
    p.last().push({ type: "init", providerSessionId: "sdk-1" });
    p.last().push({ type: "delta", text: "Começando a" });
    await until(() => of("chat.delta", sid).length > 0);
    await t.sessions.interrupt(sid);
    expect(p.last().interrupts).toBe(1);
    expect(() => t.sessions.send(sid, "outra")).toThrow(/Aguarde/);
    expect(t.sessions.get(sid).busy).toBe(true);
    p.last().push({ type: "error", message: "Falha no chat (error_during_execution)" });
    await until(() => of("chat.turn_end", sid).length > 0);
    expect(of("chat.turn_end", sid)[0]).toMatchObject({ interrupted: true });
    expect(of("chat.error", sid)).toHaveLength(0);
    const s = t.sessions.get(sid);
    expect(s.state).toBe("live");
    expect(s.busy).toBe(false);
    const assistant = t.repos.chatMessages.list(sid).find((m) => m.role === "assistant");
    expect(assistant?.contentMd).toMatch(/^Começando a/);
    expect(assistant?.contentMd).toMatch(/interrompida/);
    // a próxima mensagem vai no mesmo processo
    t.sessions.send(sid, "outra");
    expect(p.handles).toHaveLength(1);
  });

  it("Parar sem result: depois do tempo de segurança o processo é fechado e a próxima mensagem retoma", async () => {
    const { sid } = setup({ interruptTimeoutMs: 50 });
    t.sessions.send(sid, "conte tudo");
    p.last().push({ type: "init", providerSessionId: "sdk-1" });
    await tick();
    await t.sessions.interrupt(sid);
    await until(() => of("chat.turn_end", sid).length > 0);
    expect(of("chat.turn_end", sid)[0]).toMatchObject({ interrupted: true });
    expect(p.handles[0]?.closed).toBe(true);
    t.sessions.send(sid, "de novo");
    expect(p.handles).toHaveLength(2);
    expect(p.last().opts.resume).toBe("sdk-1");
  });

  it("handle velho: erro tardio de um processo já substituído não derruba a sessão nova", async () => {
    const { sid } = setup();
    await turn(sid, "a", [{ type: "init", providerSessionId: "sdk-1" }, endTurn(0.1)]);
    const old = p.handles[0] as Scripted;
    t.sessions.hibernate(sid);
    t.sessions.send(sid, "b");
    expect(p.handles).toHaveLength(2);
    // o processo antigo "acorda" com um erro depois de fechado: ignorado
    old.push({ type: "error", message: "processo encerrado" });
    await tick();
    expect(t.sessions.get(sid).state).toBe("live");
    expect(of("chat.error", sid)).toHaveLength(0);
    p.last().push(endTurn(0.2));
    await until(() => of("chat.turn_end", sid).length === 2);
  });

  it("processo do CLI saiu no meio do turno: erro amigável, ocupado liberado e a próxima mensagem retoma", async () => {
    const { sid } = setup();
    t.sessions.send(sid, "a");
    p.last().push({ type: "init", providerSessionId: "sdk-1" });
    await tick();
    p.last().end();
    await until(() => of("chat.error", sid).length > 0);
    expect(t.sessions.get(sid).busy).toBe(false);
    t.sessions.send(sid, "b");
    expect(p.handles).toHaveLength(2);
    expect(p.last().opts.resume).toBe("sdk-1");
  });

  it("processo saiu sem turno ativo: sai do mapa em silêncio e a próxima mensagem abre outro", async () => {
    const { sid } = setup();
    await turn(sid, "a", [{ type: "init", providerSessionId: "sdk-1" }, endTurn(0.1)]);
    p.last().end();
    await tick();
    expect(of("chat.error", sid)).toHaveLength(0);
    t.sessions.send(sid, "b");
    expect(p.handles).toHaveLength(2);
  });

  it("hibernar com turno ativo encerra o 'pensando' na web (turn_end interrompido) e o GET mostra busy", async () => {
    const { sid } = setup();
    t.sessions.send(sid, "a");
    p.last().push({ type: "init", providerSessionId: "sdk-1" });
    await tick();
    const r = await t.api(`/api/sessions/${sid}`);
    expect(((await r.json()) as { session: { busy: boolean } }).session.busy).toBe(true);
    t.sessions.hibernate(sid);
    expect(of("chat.turn_end", sid)[0]).toMatchObject({ interrupted: true });
    expect(t.sessions.get(sid).busy).toBe(false);
    const list = (await (await t.api("/api/sessions")).json()) as {
      sessions: Array<{ id: string; busy?: boolean }>;
    };
    expect(list.sessions.find((s) => s.id === sid)?.busy).toBe(false);
  });

  it("resume perdido (falha antes do init): reabre sem resume com o histórico recente e uma nota", async () => {
    const { sid } = setup();
    await turn(sid, "meu nome é Ana", [
      { type: "init", providerSessionId: "sdk-1" },
      { type: "delta", text: "Prazer, Ana." },
      endTurn(0.1),
    ]);
    t.sessions.hibernate(sid);
    t.sessions.send(sid, "e agora?");
    expect(p.last().opts.resume).toBe("sdk-1");
    p.last().push({ type: "error", message: "No conversation found with session ID: sdk-1" });
    await until(() => p.handles.length === 3);
    const fresh = p.last();
    expect(fresh.opts.resume ?? null).toBeNull();
    expect(fresh.sent[0]).toContain("Prazer, Ana.");
    expect(fresh.sent[0]).toContain("e agora?");
    fresh.push({ type: "init", providerSessionId: "sdk-2" });
    fresh.push(endTurn(0.05));
    await until(() => of("chat.turn_end", sid).length === 2);
    expect(of("chat.error", sid)).toHaveLength(0);
    expect(t.repos.chatSessions.get(sid)?.providerSessionId).toBe("sdk-2");
    expect(t.repos.chatMessages.list(sid).some((m) => m.role === "system_note")).toBe(true);
  });

  it("mudar a categoria com a sessão viva reabre o processo (tools novas) e avisa a web", async () => {
    const { sid } = setup();
    await turn(sid, "a", [{ type: "init", providerSessionId: "sdk-1" }, endTurn(0.1)]);
    expect(p.last().opts.tools).toContain("WebSearch");
    const r = await t.api(`/api/sessions/${sid}`, json({ category: "ingest" }, "PATCH"));
    expect(r.status).toBe(200);
    expect(p.handles[0]?.closed).toBe(true);
    expect(t.events).toContainEqual(
      expect.objectContaining({ type: "chat.session_updated", sessionId: sid, category: "ingest" }),
    );
    t.sessions.send(sid, "b");
    expect(p.handles).toHaveLength(2);
    expect(p.last().opts.category).toBe("ingest");
    expect(p.last().opts.tools).not.toContain("WebSearch");
    expect(p.last().opts.resume).toBe("sdk-1");
  });

  it("teto de custo por sessão: o processo recebe só o que resta; estourado, o envio devolve limite", async () => {
    const { sid } = setup();
    t.repos.settings.set(CHAT_SETTING_KEYS.maxBudgetUsd, 1);
    t.repos.chatSessions.addUsage(sid, { inputTokens: 0, outputTokens: 0, costUsd: 0.9 });
    t.sessions.send(sid, "a");
    expect(p.last().opts.maxBudgetUsd).toBeCloseTo(0.1, 6);
    p.last().push({ type: "init", providerSessionId: "sdk-1" });
    p.last().push(endTurn(0.15));
    await until(() => of("chat.turn_end", sid).length === 1);
    const r = await t.api(`/api/sessions/${sid}/messages`, json({ text: "mais" }));
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("budget_exhausted");
    expect(of("chat.limit", sid)).toContainEqual(expect.objectContaining({ reason: "max_budget" }));
  });

  it("blocos de texto do mesmo turno são separados por linha em branco", async () => {
    const { sid } = setup();
    await turn(sid, "a", [
      { type: "init", providerSessionId: "sdk-1" },
      { type: "text_break" },
      { type: "delta", text: "Vou consultar." },
      { type: "text_break" },
      { type: "delta", text: "Encontrei." },
      endTurn(0.1),
    ]);
    const a = t.repos.chatMessages.list(sid).find((m) => m.role === "assistant");
    expect(a?.contentMd).toBe("Vou consultar.\n\nEncontrei.");
    expect(of("chat.delta", sid).map((e) => (e as { text: string }).text)).toEqual([
      "Vou consultar.",
      "\n\nEncontrei.",
    ]);
  });

  it("retomar com o cartão novo no system prompt não repete a nota do cartão", async () => {
    const { sid, profileId } = setup();
    await turn(sid, "a", [{ type: "init", providerSessionId: "sdk-1" }, endTurn(0.1)]);
    t.sessions.hibernate(sid);
    await t.api(
      `/api/profiles/${profileId}`,
      json({ pitch: "Backend que mede tudo em produção." }, "PATCH"),
    );
    t.sessions.send(sid, "b");
    const fresh = p.last();
    expect(fresh.opts.systemPrompt).toContain("mede tudo em produção");
    expect(fresh.sent[0]).toBe("b");
    expect(t.repos.chatMessages.list(sid).some((m) => m.role === "system_note")).toBe(false);
  });
});

describe("auditoria B · /mcp sem estado", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("GET /mcp devolve 405 com Allow: POST em vez de abrir um stream eterno", async () => {
    t = makeTestApp();
    const r = await t.api("/mcp", { headers: { accept: "text/event-stream" } });
    expect(r.status).toBe(405);
    expect(r.headers.get("allow")).toBe("POST");
  });
});
