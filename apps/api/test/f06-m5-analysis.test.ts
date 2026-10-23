import { createPostingTools, seedFixture } from "@narnia-jobs/core";
import type { AnyWsEvent, JobAnalysis } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { postingLinks } from "../src/chat/session-manager";
import { makeTestApp, type TestApp } from "./helpers";

/** F06/M5 · análise da vaga: conversa própria com título, tools da vaga, gravação com evidência real e validade. */
const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
async function waitFor(events: AnyWsEvent[], pred: (e: AnyWsEvent) => boolean, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (events.some(pred)) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("evento não chegou");
}

const JD = `Desenvolvedor(a) Backend Sênior
Empresa: Globex Consultoria · Cliente: Initech Bank
São Paulo - SP · Híbrido · CLT

Requisitos:
- 5+ anos com Node.js e TypeScript
- PostgreSQL e Kubernetes

Diferenciais:
- AWS e Kafka`;

describe("F06/M5 · análise da vaga", () => {
  let t: TestApp;
  afterEach(() => {
    t?.sessions.closeAll();
    t?.cleanup();
  });

  it("pelo chat: salva a vaga, abre a conversa 'empresa/cliente - role' e a análise é gravada lá", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const sid = (
      (await (await t.api("/api/sessions", json({ category: "career" }))).json()) as {
        session: { id: string };
      }
    ).session.id;
    await t.api(`/api/sessions/${sid}/messages`, json({ text: `analisa esta vaga: ${JD}` }));
    await waitFor(t.events, (e) => e.type === "chat.turn_end" && e.sessionId === sid);
    const [posting] = t.repos.postings.list();
    expect(posting).toMatchObject({
      company: "Globex Consultoria",
      client: "Initech Bank",
      role: "backend",
    });
    const job = t.repos.chatSessions.list().find((s) => s.category === "job");
    expect(job).toMatchObject({
      title: "Globex Consultoria/Initech Bank - Backend",
      postingId: posting?.id,
    });
    // a mensagem guarda o link da conversa nova e da vaga
    const calls = t.repos.chatMessages.list(sid).flatMap((m) => m.toolCalls);
    expect(calls.find((c) => c.name === "posting_open_analysis")?.sessionId).toBe(job?.id);
    expect(calls.find((c) => c.name === "posting_create")?.postingId).toBe(posting?.id);
    // a conversa da análise roda sozinha e grava
    await waitFor(t.events, (e) => e.type === "chat.turn_end" && e.sessionId === job?.id);
    const saved = t.repos.jobAnalyses.latest(posting?.id as string);
    expect(saved?.chatSessionId).toBe(job?.id);
    // a bandeja fica sabendo: notificação informativa "Análise pronta" com o link da vaga (correção 2026-10-15)
    const done = t.repos.notifications.list().find((n) => n.kind === "posting.analysis_done");
    expect(done).toMatchObject({
      title: "Análise pronta: Globex Consultoria/Initech Bank - Backend",
      actionUrl: `/vagas/${posting?.id}`,
      readAt: null,
    });
    expect(
      t.events.some(
        (e) => e.type === "notification.created" && e.notification.kind === "posting.analysis_done",
      ),
    ).toBe(true);
    expect(t.repos.notifications.countUnresolved()).toBe(0);
    // a conversa da vaga nasceu já trabalhando, avisada pelo WS
    expect(t.events.some((e) => e.type === "chat.session_updated" && e.sessionId === job?.id)).toBe(
      true,
    );
    expect((saved?.analysis as JobAnalysis | undefined)?.matches[0]?.evidence[0]?.kind).toBe(
      "skill",
    );
    const jobCalls = t.repos.chatMessages.list(job?.id as string).flatMap((m) => m.toolCalls);
    expect(jobCalls.find((c) => c.name === "analysis_save")?.postingId).toBe(posting?.id);
    expect(t.repos.chatMessages.list(job?.id as string)[0]).toMatchObject({
      role: "system_note",
      contentMd: "Análise da vaga Globex Consultoria/Initech Bank - Backend",
    });
  });

  it("pela página: POST /api/postings/:id/analyze abre a conversa; teto cheio devolve 409 session_limit", async () => {
    t = makeTestApp();
    seedFixture(t.repos, "engineer");
    const p = t.repos.postings.create({ company: "Nubank", role: "backend", jdText: JD });
    const r = await t.api(`/api/postings/${p.id}/analyze`, { method: "POST" });
    expect(r.status).toBe(201);
    expect(((await r.json()) as { session: { title: string } }).session.title).toBe(
      "Nubank - Backend",
    );
    for (let i = 0; i < 5; i++) await t.api("/api/sessions", json({ category: "career" }));
    const full = await t.api(`/api/postings/${p.id}/analyze`, { method: "POST" });
    expect(full.status).toBe(409);
    expect((await t.api("/api/postings/nao-existe/analyze", { method: "POST" })).status).toBe(404);
  });

  it("analysis.save recusa evidência inexistente e perfil recomendado fora da lista", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const p = t.repos.postings.create({ company: "Nubank" });
    const tools = createPostingTools(t.repos, {
      ports: { intake: async () => ({ ok: false, code: "x", message: "x" }) },
    });
    const base: JobAnalysis = {
      summary: "ok",
      profiles: [{ profileId: ids.profileId, fit: 70, rationale: "r", confidence: "medium" }],
      recommendedProfileId: ids.profileId,
      recommendationRationale: "r",
      matches: [
        { requirement: "Go", evidence: [{ kind: "skill", id: "inventado" }], strength: "strong" },
      ],
      gaps: [],
      risks: [],
      atsKeywordsMissing: [],
      likelyQuestions: [],
      studyRecommendations: [],
      cvImprovements: [],
      seniority: { asked: null, profile: null, note: "" },
    };
    await expect(tools["analysis.save"]({ postingId: p.id, analysis: base })).rejects.toThrow(
      /inventado/,
    );
    await expect(
      tools["analysis.save"]({
        postingId: p.id,
        analysis: { ...base, matches: [], recommendedProfileId: "outro" },
      }),
    ).rejects.toThrow(/Perfil inexistente|recomendado/);
    const ok = await tools["analysis.save"]({
      postingId: p.id,
      analysis: { ...base, matches: [] },
    });
    expect(ok.url).toBe(`/vagas/${p.id}`);
  });

  it("validade (F06-10): fato novo ou vaga editada marcam a análise como desatualizada", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const p = t.repos.postings.create({ company: "Nubank" });
    t.repos.jobAnalyses.add({
      postingId: p.id,
      analysis: { summary: "s" },
      recommendedProfileId: ids.profileId,
      factsVersion: t.repos.settings.getFactsVersion(),
      postingUpdatedAt: p.contentUpdatedAt,
      models: ["sonnet"],
      usage: null,
      chatSessionId: null,
    });
    const view = async () =>
      (
        (await (await t.api(`/api/postings/${p.id}/analyses`)).json()) as {
          analyses: Array<{ stale: { facts: boolean; posting: boolean } }>;
        }
      ).analyses[0]?.stale;
    expect(await view()).toEqual({ facts: false, posting: false });
    // extração do modelo terminando depois da análise e troca de status não envelhecem (correção 2026-10-15)
    await new Promise((r) => setTimeout(r, 5));
    t.repos.postings.update(p.id, { title: "Backend" }, { source: "model" });
    t.repos.postings.setStatus(p.id, "ready");
    expect(await view()).toEqual({ facts: false, posting: false });
    t.repos.settings.bumpFactsVersion();
    await new Promise((r) => setTimeout(r, 5));
    t.repos.postings.update(p.id, { city: "Recife" });
    expect(await view()).toEqual({ facts: true, posting: true });
  });

  it("postingLinks extrai a conversa aberta e a vaga das saídas das tools", () => {
    expect(
      postingLinks("posting_open_analysis", JSON.stringify({ sessionId: "s1", url: "/chat/s1" })),
    ).toEqual({ sessionId: "s1" });
    expect(postingLinks("posting_create", JSON.stringify({ postingId: "p1" }))).toEqual({
      postingId: "p1",
    });
    expect(
      postingLinks("analysis_save", JSON.stringify({ analysisId: "a", url: "/vagas/p2" })),
    ).toEqual({ postingId: "p2" });
    expect(postingLinks("fact_search", "{}")).toEqual({});
    expect(postingLinks("posting_create", "não é json")).toEqual({});
  });
});

describe("F06 · análise não concluída na bandeja (2026-10-15)", () => {
  it("conversa da vaga que termina o turno sem gravar a análise vira pendência; gravar depois resolve", async () => {
    const t = makeTestApp();
    try {
      const ids = seedFixture(t.repos, "engineer");
      const p = t.repos.postings.create({ company: "Nubank", role: "backend" });
      const s = t.repos.chatSessions.create({
        profileId: null,
        category: "job",
        title: "Nubank - Backend",
        provider: "mock",
        model: "sonnet",
      });
      t.repos.chatSessions.setPosting(s.id, p.id);
      // o mock responde sem gravar (mensagem comum, não a nota da análise)
      t.sessions.send(s.id, "o que acha do meu perfil?");
      await waitFor(t.events, (e) => e.type === "chat.turn_end" && e.sessionId === s.id);
      const open = () =>
        t.repos.notifications.list().filter((n) => n.kind === "posting.analysis_incomplete");
      expect(open()).toHaveLength(1);
      expect(open()[0]).toMatchObject({
        title: "Análise não concluída: Nubank - Backend",
        actionUrl: `/chat/${s.id}`,
        severity: "warning",
      });
      expect(
        t.events.some(
          (e) =>
            e.type === "notification.created" &&
            e.notification.kind === "posting.analysis_incomplete",
        ),
      ).toBe(true);
      // gravar a análise nessa conversa resolve a pendência
      const tools = createPostingTools(t.repos, {
        sessionId: s.id,
        ports: { intake: async () => ({ ok: false, code: "x", message: "x" }) },
      });
      await tools["analysis.save"]({
        postingId: p.id,
        analysis: {
          summary: "ok",
          profiles: [{ profileId: ids.profileId, fit: 70, confidence: "medium", rationale: "r" }],
          recommendedProfileId: ids.profileId,
          recommendationRationale: "r",
          matches: [],
          gaps: [],
          risks: [],
          atsKeywordsMissing: [],
          likelyQuestions: [],
          studyRecommendations: [],
          cvImprovements: [],
          seniority: { asked: null, profile: null, note: "ok" },
        },
      });
      expect(open()).toHaveLength(0);
    } finally {
      t.sessions.closeAll();
      t.cleanup();
    }
  });

  it("conversa de vaga que já tem a análise gravada não vira pendência", async () => {
    const t = makeTestApp();
    try {
      seedFixture(t.repos, "engineer");
      const sid = (
        (await (await t.api("/api/sessions", json({ category: "career" }))).json()) as {
          session: { id: string };
        }
      ).session.id;
      await t.api(`/api/sessions/${sid}/messages`, json({ text: `analisa esta vaga: ${JD}` }));
      const job = async () => t.repos.chatSessions.list().find((s) => s.category === "job");
      await waitFor(t.events, (e) => e.type === "chat.turn_end" && e.sessionId === sid);
      const j = await job();
      await waitFor(t.events, (e) => e.type === "chat.turn_end" && e.sessionId === j?.id);
      expect(
        t.repos.notifications.list().filter((n) => n.kind === "posting.analysis_incomplete"),
      ).toHaveLength(0);
    } finally {
      t.sessions.closeAll();
      t.cleanup();
    }
  });
});

describe("F06/M5 · conversa da vaga não abre outra", () => {
  it("posting.open_analysis numa conversa job recusa e liga a vaga à conversa", async () => {
    const t = makeTestApp();
    try {
      const p = t.repos.postings.create({ company: "Nubank", role: "backend" });
      const s = t.repos.chatSessions.create({
        profileId: null,
        category: "job",
        title: "Nubank - Backend",
        provider: "mock",
        model: "sonnet",
      });
      const tools = createPostingTools(t.repos, {
        sessionId: s.id,
        ports: {
          intake: async () => ({ ok: false, code: "x", message: "x" }),
          openAnalysis: async () => ({ sessionId: "nunca", title: "x" }),
        },
      });
      await expect(tools["posting.open_analysis"]({ postingId: p.id })).rejects.toThrow(
        /analise aqui/,
      );
      expect(t.repos.chatSessions.get(s.id)?.postingId).toBe(p.id);
    } finally {
      t.cleanup();
    }
  });
});

describe("F06/M6 · Configurações › Modelos", () => {
  it("padrões, gravação parcial sem apagar outras chaves e só modelos do Claude; a análise usa o modelo escolhido", async () => {
    const t = makeTestApp();
    try {
      t.repos.settings.set("models", { analyze: "opus" });
      const g = (await (await t.api("/api/settings/models")).json()) as {
        models: Record<string, string>;
      };
      expect(g.models).toEqual({
        posting_extract: "haiku",
        posting_merge: "haiku",
        posting_duplicate: "haiku",
        posting_analyze: "sonnet",
        cv_generate: "sonnet",
        cv_review: "haiku",
        application_locate: "haiku",
        application_answer: "sonnet",
      });
      const put = await t.api("/api/settings/models", json({ posting_analyze: "opus" }, "PUT"));
      expect(
        ((await put.json()) as { models: Record<string, string> }).models.posting_analyze,
      ).toBe("opus");
      expect(t.repos.settings.get<Record<string, string>>("models")?.analyze).toBe("opus");
      expect(
        (await t.api("/api/settings/models", json({ posting_extract: "gpt-5" }, "PUT"))).status,
      ).toBe(400);
      seedFixture(t.repos, "engineer");
      const p = t.repos.postings.create({ company: "Nubank", role: "backend" });
      const r = (await (
        await t.api(`/api/postings/${p.id}/analyze`, { method: "POST" })
      ).json()) as {
        session: { model: string };
      };
      expect(r.session.model).toBe("opus");
    } finally {
      t.sessions.closeAll();
      t.cleanup();
    }
  });
});
