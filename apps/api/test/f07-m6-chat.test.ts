import { applyToPosting, seedFixture } from "@narnia-jobs/core";
import { MockProvider } from "@narnia-jobs/providers";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * F07/M6 · "Conversar sobre esta candidatura": uma conversa por candidatura (categoria `job`, ligada à vaga), com a
 * nota da candidatura e a skill `candidaturas`; a segunda mensagem segue na mesma.
 */
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

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

async function waitTurn(t: TestApp, sessionId: string) {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    if (t.events.some((e) => e.type === "chat.turn_end" && e.sessionId === sessionId)) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("turno não terminou");
}

describe("POST /api/job-applications/:id/chat", () => {
  let t: TestApp;
  afterEach(() => {
    t?.sessions.closeAll();
    t?.cleanup();
  });

  it("primeira mensagem cria a conversa '· Candidatura' com a nota e a skill; a segunda vai na mesma", async () => {
    const rec = recordingProvider();
    t = makeTestApp({ provider: rec.provider });
    const { profileId } = seedFixture(t.repos, "engineer");
    const p = t.repos.postings.create({ company: "Acme", title: "Backend Sr", role: "backend" });
    const doc = t.repos.documents.create({
      kind: "cv",
      profileId,
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
    const a = applyToPosting(t.repos, {
      postingId: p.id,
      cvVersionId: v.id,
      appliedOn: "2026-10-20",
    });
    const message = "Passei para a entrevista técnica!";
    const r = await t.api(`/api/job-applications/${a.id}/chat`, json({ message }));
    expect(r.status).toBe(201);
    const { session } = (await r.json()) as {
      session: { id: string; category: string; postingId: string; title: string };
    };
    expect(session).toMatchObject({
      category: "job",
      postingId: p.id,
      title: "Acme - Backend · Candidatura",
    });
    expect(t.repos.chatMessages.list(session.id, { limit: 10 })[0]).toMatchObject({
      role: "user",
      contentMd: message,
    });
    expect(rec.sent[0]).toContain(a.id);
    expect(rec.sent[0]).toContain("job_application_set_stage");
    expect(rec.sent[0]).toContain(message);
    await waitTurn(t, session.id);
    const again = await t.api(`/api/job-applications/${a.id}/chat`, json({ message: "e agora?" }));
    expect(((await again.json()) as { session: { id: string } }).session.id).toBe(session.id);
    expect(
      (await t.api("/api/job-applications/nao-existe/chat", json({ message: "oi" }))).status,
    ).toBe(404);
  });
});
