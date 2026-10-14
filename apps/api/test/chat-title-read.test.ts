import { seedFixture } from "@narnia-jobs/core";
import {
  type ChatEvent,
  type ChatHandle,
  type ChatOpenOptions,
  type ChatTitleInput,
  createAsyncQueue,
  MockProvider,
} from "@narnia-jobs/providers";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * Chat (pedido do dono, 2026-10-13): o tema da conversa sai da primeira mensagem pelo modelo mais barato, junto com a
 * primeira resposta, e o gasto fica registrado; a marca de leitura avança quando a mensagem aparece na tela.
 */
class ScriptedProvider extends MockProvider {
  titles: ChatTitleInput[] = [];
  push: (e: ChatEvent) => void = () => undefined;
  override openChat(_opts: ChatOpenOptions): ChatHandle {
    const q = createAsyncQueue<ChatEvent>();
    this.push = (e) => q.push(e);
    return {
      send: () => undefined,
      events: q.iterable,
      interrupt: async () => undefined,
      setModel: async () => undefined,
      close: () => undefined,
    };
  }
  override async chatTitle(input: ChatTitleInput) {
    this.titles.push(input);
    const r = await super.chatTitle(input);
    return { ...r, output: { title: "Negociação de salário PJ." }, costUsd: 0.0007 };
  }
}

const tick = () => new Promise((r) => setTimeout(r, 15));
async function until(pred: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("condição não chegou");
    await tick();
  }
}

describe("título da conversa e mensagens lidas", () => {
  let t: TestApp;
  afterEach(() => {
    t?.sessions.closeAll();
    t?.cleanup();
  });

  it("a primeira mensagem dá o tema com haiku; o gasto vai para o medidor e a conversa; a segunda não renomeia", async () => {
    const p = new ScriptedProvider();
    t = makeTestApp({ provider: p });
    const ids = seedFixture(t.repos, "engineer");
    const s = t.sessions.create({ category: "career", profileId: ids.profileId });
    expect(s.title).toBe("Nova conversa");
    t.sessions.send(s.id, "[anexo: cv.pdf · fileId 01ABC]\nQuanto pedir numa proposta PJ da Acme?");
    await until(() => t.repos.chatSessions.get(s.id)?.title !== "Nova conversa");
    expect(p.titles).toEqual([
      { message: "[anexo: cv.pdf]\nQuanto pedir numa proposta PJ da Acme?", model: "haiku" },
    ]);
    // sem o ponto final que o modelo deixou
    expect(t.repos.chatSessions.get(s.id)?.title).toBe("Negociação de salário PJ");
    expect(t.events.some((e) => e.type === "chat.session_updated" && e.sessionId === s.id)).toBe(
      true,
    );
    const usage = t.repos.usageEvents.list().filter((u) => u.category === "chat.title");
    expect(usage).toHaveLength(1);
    expect(usage[0]?.sessionId).toBe(s.id);
    expect(usage[0]?.costUsdEst).toBeCloseTo(0.0007);
    expect(t.repos.chatSessions.get(s.id)?.costUsdEst).toBeCloseTo(0.0007);

    p.push({
      type: "turn_end",
      text: "Vamos lá.",
      providerSessionId: "sdk-1",
      costUsd: 0,
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        model: "sonnet",
      },
    });
    await until(() => t.events.some((e) => e.type === "chat.turn_end"));
    t.sessions.send(s.id, "E se for CLT?");
    await tick();
    expect(p.titles).toHaveLength(1);
  });

  it("título dado pelo usuário enquanto o modelo pensava vale; falha do modelo deixa 'Nova conversa'", async () => {
    const p = new ScriptedProvider();
    t = makeTestApp({ provider: p });
    const ids = seedFixture(t.repos, "engineer");
    const s = t.sessions.create({ category: "career", profileId: ids.profileId });
    t.sessions.send(s.id, "oi");
    await t.sessions.patch(s.id, { title: "Meu nome" });
    await until(() => t.repos.usageEvents.list().some((u) => u.category === "chat.title"));
    expect(t.repos.chatSessions.get(s.id)?.title).toBe("Meu nome");

    const failing = new MockProvider({ errors: { chatTitle: "fora do ar" } });
    t.sessions.closeAll();
    t.cleanup();
    t = makeTestApp({ provider: failing });
    const ids2 = seedFixture(t.repos, "engineer");
    const s2 = t.sessions.create({ category: "career", profileId: ids2.profileId });
    t.sessions.send(s2.id, "Quero mudar de área");
    await tick();
    await tick();
    expect(t.repos.chatSessions.get(s2.id)?.title).toBe("Nova conversa");
  });

  it("POST /read marca até a mensagem vista; a lista traz as não lidas", async () => {
    t = makeTestApp({ provider: new ScriptedProvider() });
    const ids = seedFixture(t.repos, "engineer");
    const s = t.sessions.create({ category: "career", profileId: ids.profileId });
    const reply = t.repos.chatMessages.add({
      sessionId: s.id,
      turnIndex: 0,
      role: "assistant",
      contentMd: "olá",
      toolCalls: [],
      usage: null,
    });
    const list = async () =>
      (await (await t.api(`/api/sessions?profile=${ids.profileId}`)).json()) as {
        sessions: Array<{ id: string; unread?: number }>;
      };
    expect((await list()).sessions.find((x) => x.id === s.id)?.unread).toBe(1);
    const post = (id: string) =>
      t.api(`/api/sessions/${id}/read`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: reply.id }),
      });
    const r = await post(s.id);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { session: { unread: number } }).session.unread).toBe(0);
    expect((await list()).sessions.find((x) => x.id === s.id)?.unread).toBe(0);
    const missing = await post("nao-existe");
    expect(missing.status).toBe(404);
  });
});
