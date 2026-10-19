import { seedFixture } from "@narnia-jobs/core";
import { MockProvider } from "@narnia-jobs/providers";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Provider que guarda o texto de cada turno enviado ao modelo. */
function recordingProvider() {
  const provider = new MockProvider();
  const sent: string[] = [];
  const open = provider.openChat.bind(provider);
  provider.openChat = (opts) => {
    const h = open(opts);
    const send = h.send.bind(h);
    h.send = (text) => {
      sent.push(text);
      send(text);
    };
    return h;
  };
  return { provider, sent };
}

/**
 * Página da vaga › assets (pedido do dono, 2026-10-19): "Regerar com mensagem" é um feedback humano sobre o CV ou a
 * carta. Abre uma conversa da vaga com a vaga e o documento no contexto; o recrutador refaz com as tools cv_*.
 */
describe("POST /api/documents/:id/feedback", () => {
  let t: TestApp;
  afterEach(() => {
    t?.sessions.closeAll();
    t?.cleanup();
  });

  it("abre a conversa da vaga com a mensagem do usuário e a nota com vaga, documento e versão", async () => {
    const rec = recordingProvider();
    t = makeTestApp({ provider: rec.provider });
    const ids = seedFixture(t.repos, "engineer");
    const p = t.repos.postings.create({ company: "Nubank", role: "backend" });
    const doc = t.repos.documents.create({
      kind: "cv",
      profileId: ids.profileId,
      postingId: p.id,
      templateId: "classico",
      paper: "A4",
      locale: "pt-BR",
      format: "pdf",
    });
    const v = t.repos.documents.addVersion(doc.id, {
      source: "agent",
      instructions: null,
      factsVersion: 1,
      postingUpdatedAt: null,
      profileHash: "h",
    });
    t.repos.documents.updateVersion(v.id, { status: "ready" });
    const message = "Dê mais destaque à liderança técnica e encurte o resumo.";
    const r = await t.api(`/api/documents/${doc.id}/feedback`, json({ message }));
    expect(r.status).toBe(201);
    const { session } = (await r.json()) as {
      session: { id: string; category: string; postingId: string; title: string };
    };
    expect(session).toMatchObject({ category: "job", postingId: p.id });
    expect(session.title).toBe("Nubank - Backend · CV");
    // na conversa aparece a mensagem do usuário; o modelo recebe a nota com o contexto
    const msgs = t.repos.chatMessages.list(session.id, { limit: 10 });
    expect(msgs[0]).toMatchObject({ role: "user", contentMd: message });
    expect(rec.sent[0]).toContain(doc.id);
    expect(rec.sent[0]).toContain(p.id);
    expect(rec.sent[0]).toContain("versão 1");
    expect(rec.sent[0]).toContain(message);
  });

  it("mensagem vazia: 400; documento inexistente: 404; geração em andamento: 409", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const doc = t.repos.documents.create({
      kind: "cv",
      profileId: ids.profileId,
      postingId: null,
      templateId: "classico",
      paper: "A4",
      locale: "pt-BR",
      format: "pdf",
    });
    t.repos.documents.addVersion(doc.id, {
      source: "agent",
      instructions: null,
      factsVersion: 1,
      postingUpdatedAt: null,
      profileHash: "h",
    });
    expect((await t.api(`/api/documents/${doc.id}/feedback`, json({ message: " " }))).status).toBe(
      400,
    );
    expect((await t.api("/api/documents/nao-existe/feedback", json({ message: "x" }))).status).toBe(
      404,
    );
    const busy = await t.api(`/api/documents/${doc.id}/feedback`, json({ message: "x" }));
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ error: { code: "busy" } });
  });
});
