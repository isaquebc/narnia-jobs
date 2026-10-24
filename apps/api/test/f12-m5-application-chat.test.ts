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

async function waitTurn(t: TestApp, sessionId: string) {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    if (t.events.some((e) => e.type === "chat.turn_end" && e.sessionId === sessionId)) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("turno não terminou");
}

/**
 * F12/M5 (decisão do dono, 2026-10-24): uma conversa própria por formulário, que funciona como o chat do recrutador
 * (pedir mudança no CV, ingerir evidência) e grava respostas na janela. Nasce na primeira mensagem, com a nota do
 * formulário e a skill `responder-candidatura`.
 */
describe("POST /api/applications/:id/chat", () => {
  let t: TestApp;
  afterEach(() => {
    t?.sessions.closeAll();
    t?.cleanup();
  });

  const form = (postingId: string | null) => {
    const f = t.repos.applications.create({
      captureId: "c1",
      postingId,
      profileId: null,
      url: "https://jobs.example/vitalis/apply",
      title: "Vitalis · Candidatura",
      fields: [],
    });
    t.repos.applications.setQuestions(f.id, [
      {
        id: "motivo",
        question: "Why are you interested in Vitalis?",
        kind: "long_text",
        options: [],
        required: true,
        maxChars: 500,
        fieldRefs: ["f1"],
        section: null,
        profileField: null,
        topic: null,
        source: "model",
      },
    ]);
    return f;
  };

  it("primeira mensagem: conversa da vaga '· Formulário', ligada ao formulário, com a nota e a skill; a segunda vai na mesma", async () => {
    const rec = recordingProvider();
    t = makeTestApp({ provider: rec.provider });
    seedFixture(t.repos, "engineer");
    const p = t.repos.postings.create({ company: "Vitalis", title: "Senior Software Engineer" });
    const f = form(p.id);
    const message = "Deixa a resposta de motivação mais curta.";
    const r = await t.api(`/api/applications/${f.id}/chat`, json({ message }));
    expect(r.status).toBe(201);
    const { session } = (await r.json()) as {
      session: { id: string; category: string; postingId: string; title: string };
    };
    expect(session).toMatchObject({
      category: "job",
      postingId: p.id,
      title: "Vitalis - Senior Software Engineer · Formulário",
    });
    expect(t.repos.applications.get(f.id)?.chatSessionId).toBe(session.id);
    // a pessoa vê a mensagem dela; o modelo recebe a nota com o formulário e o procedimento da skill
    const msgs = t.repos.chatMessages.list(session.id, { limit: 10 });
    expect(msgs[0]).toMatchObject({ role: "user", contentMd: message });
    expect(rec.sent[0]).toContain(f.id);
    expect(rec.sent[0]).toContain("application_get");
    expect(rec.sent[0]).toContain(message);
    // a leitura do formulário devolve a conversa para a janela
    const view = (await (await t.api(`/api/applications/${f.id}`)).json()) as {
      application: { chatSessionId: string };
    };
    expect(view.application.chatSessionId).toBe(session.id);
    // o recrutador (mock) lê o formulário e grava a resposta combinada: volta para a janela com origem chat
    await waitTurn(t, session.id);
    expect(t.repos.applications.latestAnswers(f.id)).toEqual([
      expect.objectContaining({ questionId: "motivo", source: "chat" }),
    ]);
    expect(t.events).toContainEqual({ type: "application.updated", applicationId: f.id });
    // segunda mensagem pela mesma rota: mesma conversa, sem a nota de novo
    const again = await t.api(`/api/applications/${f.id}/chat`, json({ message: "e agora?" }));
    expect(again.status).toBe(201);
    expect(((await again.json()) as { session: { id: string } }).session.id).toBe(session.id);
    expect(rec.sent[1]).toBe("e agora?");
    expect(t.repos.chatSessions.list().filter((s) => s.category === "job")).toHaveLength(1);
  });

  it("sem vaga ligada o título usa o site; formulário que não existe: 404; mensagem vazia: 400", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const f = form(null);
    const r = await t.api(`/api/applications/${f.id}/chat`, json({ message: "oi" }));
    expect(((await r.json()) as { session: { title: string } }).session.title).toBe(
      "Formulário · jobs.example",
    );
    expect((await t.api("/api/applications/nao/chat", json({ message: "oi" }))).status).toBe(404);
    expect((await t.api(`/api/applications/${f.id}/chat`, json({ message: " " }))).status).toBe(
      400,
    );
  });
});
