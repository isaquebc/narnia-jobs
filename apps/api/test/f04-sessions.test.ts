import { CHAT_SETTING_KEYS, seedFixture } from "@narnia-jobs/core";
import { type ChatHandle, type ChatOpenOptions, MockProvider } from "@narnia-jobs/providers";
import type { AnyWsEvent } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/chat/session-manager";
import { makeTestApp, type TestApp, uploadFixture } from "./helpers";

/**
 * F04/M3 · sessões de chat no api (F04-10): `SessionManager` + rotas. O provider é o mock com roteiros, mas as tools
 * são reais: o mock chama o `/mcp` da própria app (em memória) com o token e o header da sessão.
 */

class SpyProvider extends MockProvider {
  opened: ChatOpenOptions[] = [];
  sent: string[] = [];
  override openChat(o: ChatOpenOptions): ChatHandle {
    this.opened.push(o);
    const h = super.openChat(o);
    return {
      send: (text) => {
        this.sent.push(text);
        h.send(text);
      },
      events: h.events,
      interrupt: () => h.interrupt(),
      setModel: (m) => h.setModel(m),
      close: () => h.close(),
    };
  }
}

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function waitFor(events: AnyWsEvent[], pred: (e: AnyWsEvent) => boolean, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = events.find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("evento não chegou");
}

const turnEnded =
  (sessionId: string, turnIndex = 0) =>
  (e: AnyWsEvent) =>
    e.type === "chat.turn_end" && e.sessionId === sessionId && e.turnIndex === turnIndex;

async function newSession(t: TestApp, body: Record<string, unknown> = {}) {
  const r = await t.api("/api/sessions", json(body));
  return {
    status: r.status,
    body: (await r.json()) as { session: { id: string; state: string; model: string } },
  };
}

describe("F04/M3 · sessões de chat", () => {
  let t: TestApp;
  afterEach(() => {
    t?.sessions.closeAll();
    t?.cleanup();
  });

  it("conversa de carreira: deltas, tool real pelo /mcp, fim de turno com uso, mensagens e uso gravados", async () => {
    const spy = new SpyProvider();
    t = makeTestApp({ provider: spy });
    const ids = seedFixture(t.repos, "engineer");
    const { status, body } = await newSession(t);
    expect(status).toBe(201);
    const sid = body.session.id;
    expect(body.session).toMatchObject({ state: "live", model: "sonnet" });

    const sent = await t.api(
      `/api/sessions/${sid}/messages`,
      json({ text: "o que está fraco no meu perfil?" }),
    );
    expect(sent.status).toBe(202);
    const end = await waitFor(t.events, turnEnded(sid));
    expect(end.type === "chat.turn_end" && end.usage.inputTokens).toBeGreaterThan(0);
    expect(
      t.events.filter((e) => e.type === "chat.delta" && e.sessionId === sid).length,
    ).toBeGreaterThan(1);
    expect(t.events).toContainEqual(
      expect.objectContaining({
        type: "chat.tool",
        sessionId: sid,
        name: "evidence_experience_list",
        phase: "start",
      }),
    );
    expect(t.events).toContainEqual(
      expect.objectContaining({
        type: "chat.tool",
        sessionId: sid,
        name: "evidence_experience_list",
        phase: "end",
      }),
    );

    // abertura com persona + cartão do perfil, plugin, /mcp com o header da sessão e o card marcado (F04-1)
    const opened = spy.opened[0] as ChatOpenOptions;
    expect(opened.systemPrompt).toContain(
      t.repos.profiles.get(ids.profileId)?.targetTitle as string,
    );
    expect(opened.mcp.headers["X-Narnia-Session"]).toBe(sid);
    expect(opened.env?.NARNIA_SESSION_HAS_CARD).toBe("1");

    const msgs = (await (await t.api(`/api/sessions/${sid}/messages`)).json()) as {
      messages: Array<{ role: string; toolCalls: Array<{ name: string }>; contentMd: string }>;
    };
    expect(msgs.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs.messages[1]?.toolCalls[0]?.name).toBe("evidence_experience_list");
    const s = t.repos.chatSessions.get(sid);
    expect(s?.providerSessionId).toMatch(/^mock-/);
    expect(s?.tokensIn).toBeGreaterThan(0);
    expect(
      t.repos.usageEvents.list().some((u) => u.sessionId === sid && u.category === "chat.career"),
    ).toBe(true);
  });

  it("teto de sessões vivas: a 6ª abertura devolve 409 com a lista das vivas (F04-3)", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    for (let i = 0; i < 5; i++) expect((await newSession(t)).status).toBe(201);
    const r = await t.api("/api/sessions", json({}));
    expect(r.status).toBe(409);
    const b = (await r.json()) as {
      error: { code: string; details: { max: number; live: unknown[] } };
    };
    expect(b.error.code).toBe("session_limit");
    expect(b.error.details.max).toBe(5);
    expect(b.error.details.live).toHaveLength(5);
  });

  it("hibernar encerra o processo; a próxima mensagem acorda com resume; reinício do api hiberna as vivas", async () => {
    const spy = new SpyProvider();
    t = makeTestApp({ provider: spy });
    seedFixture(t.repos, "engineer");
    const sid = (await newSession(t)).body.session.id;
    await t.api(`/api/sessions/${sid}/messages`, json({ text: "oi" }));
    await waitFor(t.events, turnEnded(sid, 0));
    const providerSid = t.repos.chatSessions.get(sid)?.providerSessionId;

    const h = await t.api(`/api/sessions/${sid}/hibernate`, json({}));
    expect(((await h.json()) as { session: { state: string } }).session.state).toBe("hibernated");
    await t.api(`/api/sessions/${sid}/messages`, json({ text: "voltei" }));
    await waitFor(t.events, turnEnded(sid, 1));
    expect(spy.opened.at(-1)?.resume).toBe(providerSid);
    expect(t.repos.chatSessions.get(sid)?.state).toBe("live");

    // boot de um api novo sobre o mesmo banco: as vivas viram hibernadas (os processos morreram)
    const boot = new SessionManager({
      repos: t.repos,
      provider: spy,
      bus: t.bus,
      mcpUrl: "http://x/mcp",
      token: "t",
    });
    expect(boot.hibernateAllOnBoot()).toBe(1);
    expect(t.repos.chatSessions.get(sid)?.state).toBe("hibernated");
  });

  it("varredura hiberna sessões sem atividade há mais de chat.hibernate_after_min (F04-4)", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    t.repos.settings.set(CHAT_SETTING_KEYS.hibernateAfterMin, 1);
    const sid = (await newSession(t)).body.session.id;
    expect(t.sessions.sweep(Date.now())).toBe(0);
    expect(t.sessions.sweep(Date.now() + 2 * 60_000)).toBe(1);
    expect(t.repos.chatSessions.get(sid)?.state).toBe("hibernated");
    expect(t.events).toContainEqual({
      type: "chat.session_updated",
      sessionId: sid,
      state: "hibernated",
    });
  });

  it("cartão do perfil mudou entre turnos: a mensagem ganha a nota com o cartão novo (F04-1)", async () => {
    const spy = new SpyProvider();
    t = makeTestApp({ provider: spy });
    const ids = seedFixture(t.repos, "engineer");
    const sid = (await newSession(t)).body.session.id;
    await t.api(`/api/sessions/${sid}/messages`, json({ text: "primeira" }));
    await waitFor(t.events, turnEnded(sid, 0));
    expect(spy.sent[0]).toBe("primeira");
    await t.api(
      `/api/profiles/${ids.profileId}`,
      json({ pitch: "Backend que mede tudo em produção." }, "PATCH"),
    );
    await t.api(`/api/sessions/${sid}/messages`, json({ text: "segunda" }));
    await waitFor(t.events, turnEnded(sid, 1));
    expect(spy.sent[1]).toMatch(
      /cartão do perfil foi atualizado[\s\S]*mede tudo em produção[\s\S]*segunda$/,
    );
    const roles = (
      (await (await t.api(`/api/sessions/${sid}/messages`)).json()) as {
        messages: Array<{ role: string }>;
      }
    ).messages.map((m) => m.role);
    expect(roles).toContain("system_note");
  });

  it("erro do provider vira chat.error com chave amigável e a sessão fica em erro", async () => {
    t = makeTestApp({
      provider: new MockProvider({ errors: { openChat: "Reached maximum number of turns (1)" } }),
    });
    seedFixture(t.repos, "engineer");
    const sid = (await newSession(t)).body.session.id;
    await t.api(`/api/sessions/${sid}/messages`, json({ text: "oi" }));
    const err = await waitFor(t.events, (e) => e.type === "chat.error" && e.sessionId === sid);
    expect(err.type === "chat.error" && err.errorKey).toBe("error.model_format");
    expect(t.repos.chatSessions.get(sid)?.state).toBe("error");
  });

  it("mensagem com turno em andamento devolve 409 turn_in_progress", async () => {
    t = makeTestApp({ provider: new MockProvider({ delayMs: 300 }) });
    seedFixture(t.repos, "engineer");
    const sid = (await newSession(t)).body.session.id;
    expect((await t.api(`/api/sessions/${sid}/messages`, json({ text: "1" }))).status).toBe(202);
    const r = await t.api(`/api/sessions/${sid}/messages`, json({ text: "2" }));
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("turn_in_progress");
    await waitFor(t.events, turnEnded(sid, 0));
  });

  it("clarificação: sessão ligada à execução; a correção vira proposta no run certo e avisa a revisão", async () => {
    const spy = new SpyProvider();
    t = makeTestApp({ provider: spy });
    seedFixture(t.repos, "engineer");
    const { body: file } = await uploadFixture(t);
    const run = (await (await t.api("/api/ingestions", json({ fileId: file.id }))).json()) as {
      id: string;
    };
    const before = t.repos.proposals.listByRun(run.id).length;
    const r = await t.api(`/api/ingestions/${run.id}/clarify`, json({}));
    expect(r.status).toBe(201);
    const s = (
      (await r.json()) as { session: { id: string; category: string; ingestionRunId: string } }
    ).session;
    expect(s).toMatchObject({ category: "clarify", ingestionRunId: run.id });
    await t.api(
      `/api/sessions/${s.id}/messages`,
      json({ text: "liderei a comunicação com o cliente" }),
    );
    await waitFor(t.events, turnEnded(s.id));
    expect(spy.sent[0]).toMatch(
      new RegExp(`clarifica a ingestão ${run.id}[\\s\\S]*liderei a comunicação`),
    );
    expect(t.repos.proposals.listByRun(run.id).length).toBe(before + 1);
    expect(t.events).toContainEqual(
      expect.objectContaining({ type: "ingestion.updated", runId: run.id }),
    );
  });

  it("listar (global, F06-8), renomear, trocar modelo, arquivar e apagar", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const sid = (await newSession(t, { title: "Carreira", model: "haiku" })).body.session.id;
    const list = (await (await t.api("/api/sessions")).json()) as {
      sessions: Array<{ id: string }>;
    };
    expect(list.sessions.map((x) => x.id)).toEqual([sid]);
    const p = await t.api(
      `/api/sessions/${sid}`,
      json({ title: "Salário", model: "opus" }, "PATCH"),
    );
    expect(
      ((await p.json()) as { session: { title: string; model: string } }).session,
    ).toMatchObject({
      title: "Salário",
      model: "opus",
    });
    const a = await t.api(`/api/sessions/${sid}`, json({ archived: true }, "PATCH"));
    expect(((await a.json()) as { session: { state: string } }).session.state).toBe("archived");
    expect(
      ((await (await t.api("/api/sessions")).json()) as { sessions: unknown[] }).sessions,
    ).toHaveLength(0);
    expect((await t.api(`/api/sessions/${sid}`, { method: "DELETE" })).status).toBe(200);
    expect((await t.api(`/api/sessions/${sid}`)).status).toBe(404);
  });

  it("fontes pesquisadas do perfil: pergunta de salário registra a fonte pelo /mcp", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const sid = (await newSession(t)).body.session.id;
    await t.api(`/api/sessions/${sid}/messages`, json({ text: "qual o salário de mercado?" }));
    await waitFor(t.events, turnEnded(sid));
    const r = (await (await t.api(`/api/research?profile=${ids.profileId}`)).json()) as {
      sources: Array<{ domain: string }>;
    };
    expect(r.sources[0]?.domain).toBe("ibge.gov.br");
  });
});
