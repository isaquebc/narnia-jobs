import { seedFixture } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * F04-fix-fundamentacao, R5 (FF-2): a rota das mensagens confere as citações de cada resposta (o balão da conversa
 * mostra o que elas apontam; a inválida fica marcada) e devolve as frases com número ou termo dos fatos sem citação.
 */
let t: TestApp;
afterEach(() => t?.cleanup());

const ref = (id: string) => id.replace(/-/g, "").slice(-6);

describe("R5 · citações nas mensagens", () => {
  it("a resposta do recrutador vem com as citações conferidas e as frases sem citação", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const s = t.repos.chatSessions.create({
      profileId: ids.profileId,
      category: "career",
      title: "Carreira",
      provider: "mock",
      model: "sonnet",
    });
    const acme = ids.experienceIds[0] as string;
    t.repos.chatMessages.add({
      sessionId: s.id,
      turnIndex: 0,
      role: "user",
      contentMd: "onde eu trabalho?",
      toolCalls: [],
      usage: null,
    });
    t.repos.chatMessages.add({
      sessionId: s.id,
      turnIndex: 0,
      role: "assistant",
      contentMd: `Você está na Acme Pagamentos [f:${ref(acme)}] e [f:000000]. Espere uns R$ 20 mil.`,
      toolCalls: [],
      usage: null,
    });
    const body = (await (await t.api(`/api/sessions/${s.id}/messages`)).json()) as {
      messages: Array<{
        role: string;
        citations?: Array<{ ref: string; valid: boolean; label: string | null }>;
        uncited?: string[];
      }>;
    };
    const user = body.messages.find((m) => m.role === "user");
    const reply = body.messages.find((m) => m.role === "assistant");
    expect(user?.citations).toBeUndefined();
    expect(reply?.citations).toEqual([
      expect.objectContaining({
        ref: ref(acme),
        valid: true,
        label: expect.stringContaining("Acme"),
      }),
      expect.objectContaining({ ref: "000000", valid: false, label: null }),
    ]);
    expect(reply?.uncited).toEqual(["Espere uns R$ 20 mil."]);
  });
});
