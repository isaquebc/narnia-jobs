import { intakePostingFromMail } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../src/events";
import { watchAutoAnalyses } from "../src/services/auto-analysis";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * F14/M4 · feed na API: `feed=1` traz as vagas vindas de e-mail pelo match; abrir a vaga é interação e tira o "nova";
 * configurações do feed; a captura da extensão completa a vaga do e-mail cujo link não abriu; o observador abre a
 * pré-análise automática uma por vez.
 */
const req = (method: string, body?: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const JD = `Desenvolvedor Backend Sênior na Acme. ${"Requisitos: Node.js, PostgreSQL e filas. ".repeat(8)}`;

describe("F14/M4 · feed", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  const mailPosting = (title: string, url: string | null, score: number | null) => {
    const { posting } = intakePostingFromMail(t.repos, {
      title,
      company: "Acme",
      location: null,
      url,
      gmailId: "g",
      platform: "linkedin",
    });
    t.repos.postings.setMatchScore(posting.id, score);
    return posting;
  };

  it("feed=1: só as do e-mail não arquivadas, maior match primeiro (sem score por último); a lista normal não muda", async () => {
    t = makeTestApp();
    await t.api("/api/postings", req("POST", { company: "Globex", title: "Manual" }));
    mailPosting("Média", null, 50);
    mailPosting("Alta", null, 90);
    mailPosting("Sem score", null, null);
    const arch = mailPosting("Arquivada", null, 99);
    t.repos.postings.setArchiveAuto(arch.id, "stale");
    const feed = (await (await t.api("/api/postings?feed=1")).json()) as {
      postings: Array<{ title: string; source: string; id: string; analyzedAt: string | null }>;
    };
    expect(feed.postings.map((p) => p.title)).toEqual(["Alta", "Média", "Sem score"]);
    // o card troca "Analisar" por "Ver análise" (pedido do dono 2026-11-12)
    const alta = feed.postings.find((p) => p.title === "Alta");
    expect(alta?.analyzedAt).toBeNull();
    t.repos.jobAnalyses.add({
      postingId: alta?.id as string,
      analysis: {},
      recommendedProfileId: null,
      factsVersion: 1,
      postingUpdatedAt: "2026-11-12T12:00:00.000Z",
      models: [],
      usage: null,
      chatSessionId: null,
    });
    const again = (await (await t.api("/api/postings?feed=1")).json()) as {
      postings: Array<{ title: string; analyzedAt: string | null }>;
    };
    expect(again.postings.find((p) => p.title === "Alta")?.analyzedAt).not.toBeNull();
    const all = (await (await t.api("/api/postings")).json()) as {
      postings: Array<{ title: string }>;
    };
    expect(all.postings.map((p) => p.title)).toContain("Manual");
  });

  it("abrir a vaga (POST seen) é interação e tira o 'nova'; o GET não grava", async () => {
    t = makeTestApp();
    const p = mailPosting("Alta", null, 90);
    expect(p.feedState).toBe("new");
    await t.api(`/api/postings/${p.id}`);
    expect(t.repos.postings.get(p.id)?.feedState).toBe("new");
    expect((await t.api(`/api/postings/${p.id}/seen`, req("POST"))).status).toBe(204);
    const after = t.repos.postings.get(p.id);
    expect(after?.feedState).toBe("seen");
    expect(after?.lastInteractionAt).not.toBeNull();
  });

  it("configurações do feed: padrões 70, 10 e 100; grava e valida", async () => {
    t = makeTestApp();
    expect(await (await t.api("/api/mail/feed-settings")).json()).toEqual({
      preanalysisCut: 70,
      preanalysisDailyCap: 10,
      linksPerRun: 100,
    });
    const r = await t.api("/api/mail/feed-settings", req("PUT", { preanalysisCut: 80 }));
    expect(await r.json()).toMatchObject({ preanalysisCut: 80 });
    expect(
      (await t.api("/api/mail/feed-settings", req("PUT", { preanalysisCut: 120 }))).status,
    ).toBe(400);
  });

  it("a captura da extensão completa a vaga do e-mail cujo link não abriu, sem criar outra", async () => {
    t = makeTestApp();
    const p = mailPosting(
      "Backend",
      "https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=x",
      null,
    );
    t.repos.postings.setLinkStatus(p.id, "failed");
    const cap = t.repos.extension.createCapture({
      kind: "page",
      url: "https://www.linkedin.com/jobs/view/desenvolvedor-backend-at-acme-4012345678/",
      title: "Vaga",
      payload: { ok: true, text: JD, company: "Acme", title: "Backend", siteName: null } as never,
      deviceId: null,
    });
    const r = await t.api(`/api/extension/captures/${cap.id}/posting`, req("POST", {}));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { completed: boolean }).completed).toBe(true);
    expect(t.repos.postings.list()).toHaveLength(1);
    expect(t.repos.postings.get(p.id)).toMatchObject({ linkStatus: "ok", status: "extracting" });
    expect(t.repos.postings.get(p.id)?.jdText).toContain("Desenvolvedor Backend Sênior");
  });
});

describe("F14/M4 · pré-análise automática (observador do api)", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("abre uma por vez: a seguinte só quando a anterior gravou a análise ou parou", async () => {
    t = makeTestApp();
    const a = intakePostingFromMail(t.repos, {
      title: "A",
      company: "Acme",
      location: null,
      url: null,
      gmailId: "g",
      platform: null,
    }).posting;
    const b = intakePostingFromMail(t.repos, {
      title: "B",
      company: "Globex",
      location: null,
      url: null,
      gmailId: "g",
      platform: null,
    }).posting;
    t.repos.postings.setAutoAnalysisAt(a.id, new Date().toISOString());
    t.repos.postings.setAutoAnalysisAt(b.id, new Date().toISOString());
    const opened: string[] = [];
    const bus = new EventBus();
    const stop = watchAutoAnalyses({
      repos: t.repos,
      bus,
      intervalMs: 60_000,
      openAnalysis: (id) => {
        opened.push(id);
        const now = new Date().toISOString();
        t.repos.db
          .prepare(
            "insert into chat_session (id, category, title, provider, model, created_at, last_activity_at, posting_id) values (?, 'job', 'x', 'mock', 'sonnet', ?, ?, ?)",
          )
          .run(`s-${id}`, now, now, id);
      },
    });
    try {
      expect(opened).toHaveLength(1);
      bus.emit({ type: "posting.updated", postingId: a.id });
      expect(opened).toHaveLength(1);
    } finally {
      stop();
    }
  });
});

describe("F14/M4 · revisão: origem da vaga salva pela extensão", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("salvar a captura grava a origem extension", async () => {
    t = makeTestApp();
    const cap = t.repos.extension.createCapture({
      kind: "page",
      url: "https://vagas.example/77",
      title: "Vaga",
      payload: { ok: true, text: JD, company: "Acme", title: "Backend", siteName: null } as never,
      deviceId: null,
    });
    const r = (await (
      await t.api(`/api/extension/captures/${cap.id}/posting`, req("POST", {}))
    ).json()) as {
      posting: { id: string };
    };
    expect(t.repos.postings.get(r.posting.id)?.source).toBe("extension");
  });
});
