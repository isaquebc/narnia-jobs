import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { findLikelyPosting, samePostingUrl } from "../../src/extension/captures";

/**
 * F12/M2 · capturas da extensão: a página lida fica guardada (com o dispositivo que leu) até virar vaga; a janela avisa
 * quando a página parece uma vaga já salva (mesmo link ou mesma empresa e cargo), sem tokens.
 */
function repos() {
  const db = openDatabase(":memory:");
  migrate(db);
  return createRepos(db);
}

describe("F12/M2 · captura", () => {
  it("grava, lê e liga à vaga salva", () => {
    const r = repos();
    const c = r.extension.createCapture({
      kind: "page",
      url: "https://vagas.example/123",
      title: "Backend Sr",
      payload: { reading: { ok: true } },
      deviceId: null,
    });
    expect(r.extension.getCapture(c.id)).toMatchObject({
      kind: "page",
      url: "https://vagas.example/123",
      title: "Backend Sr",
      payload: { reading: { ok: true } },
      postingId: null,
    });
    const p = r.postings.create({ title: "Backend Sr" });
    r.extension.linkCapturePosting(c.id, p.id);
    expect(r.extension.getCapture(c.id)?.postingId).toBe(p.id);
    expect(r.extension.getCapture("nao-existe")).toBeNull();
  });
});

describe("F12/M2 · vaga provavelmente já salva", () => {
  it("mesmo link (sem query de rastreio, barra no fim ou âncora)", () => {
    expect(
      samePostingUrl(
        "https://vagas.example/jobs/123/?utm_source=x#apply",
        "https://vagas.example/jobs/123",
      ),
    ).toBe(true);
    expect(samePostingUrl("https://vagas.example/jobs/123", "https://vagas.example/jobs/124")).toBe(
      false,
    );
    // o id da vaga na query conta (LinkedIn: /jobs/view/?currentJobId=…)
    expect(
      samePostingUrl("https://site.example/vagas?id=1", "https://site.example/vagas?id=2"),
    ).toBe(false);
  });

  it("acha pelo link ou por empresa e cargo; nada parecido = null", () => {
    const r = repos();
    const a = r.postings.create({
      title: "Engenheira Backend Sênior",
      company: "Acme S.A.",
      postingUrl: "https://vagas.example/a",
    });
    const all = r.postings.list();
    expect(findLikelyPosting(all, { url: "https://vagas.example/a?ref=li" })?.id).toBe(a.id);
    expect(
      findLikelyPosting(all, {
        url: "https://outro.example/x",
        title: "engenheira backend senior",
        company: "ACME SA",
      })?.id,
    ).toBe(a.id);
    expect(
      findLikelyPosting(all, {
        url: "https://outro.example/x",
        title: "Designer",
        company: "Acme",
      }),
    ).toBeNull();
  });
});

describe("F12/M2 · análise pedida pela janela", () => {
  it("pedido → aguardando; conversa aberta ou erro tiram da espera", () => {
    const r = repos();
    const p = r.postings.create({ title: "Backend Sr" });
    const mk = () => {
      const c = r.extension.createCapture({
        kind: "page",
        url: "https://vagas.example/1",
        title: null,
        payload: {},
        deviceId: null,
      });
      r.extension.linkCapturePosting(c.id, p.id);
      return c.id;
    };
    const a = mk();
    const b = mk();
    mk(); // sem pedido de análise
    r.extension.requestCaptureAnalysis(a);
    r.extension.requestCaptureAnalysis(b);
    expect(r.extension.capturesAwaitingAnalysis(p.id).map((c) => c.id)).toEqual([a, b]);
    r.extension.setCaptureAnalysis(a, { sessionId: "s1" });
    r.extension.setCaptureAnalysis(b, { error: "session_limit" });
    expect(r.extension.capturesAwaitingAnalysis(p.id)).toEqual([]);
    expect(r.extension.getCapture(a)).toMatchObject({
      analysisSessionId: "s1",
      analysisError: null,
    });
    expect(r.extension.getCapture(b)).toMatchObject({
      analysisSessionId: null,
      analysisError: "session_limit",
    });
    // "Analisar de novo" depois do erro: a conversa nova limpa o erro
    r.extension.setCaptureAnalysis(b, { sessionId: "s2" });
    expect(r.extension.getCapture(b)).toMatchObject({
      analysisSessionId: "s2",
      analysisError: null,
    });
  });
});

describe("F12/M2 · migração", () => {
  it("0018 e 0019 entram sobre um banco da versão anterior", () => {
    const db = openDatabase(":memory:");
    migrate(db, { until: "0017_extension" });
    expect(migrate(db).applied).toEqual([
      "0018_extension_capture",
      "0019_extension_capture_analysis",
    ]);
    expect(createRepos(db).extension.getCapture("x")).toBeNull();
  });
});
