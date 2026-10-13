import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { applyCheckResults, checkEvidence, runCheckLayer1 } from "../../src/ingest/review-check";

/**
 * "Sem suporte" com motivo e conferência tolerante à forma (pedido do dono, 2026-10-13): muitos itens caíam na camada 1
 * só porque o modelo "arrumava" o trecho (aspas, travessão, maiúsculas, acento) ou o PDF quebrava palavras.
 */
const cv = {
  cv: "Ana Maria Exemplo — Engenheira de Software Sênior na “Acme Pagamentos”\nResponsável pelo desenvol-\nvimento da plataforma de eﬁciência operacional.",
};

describe("camada 1 tolerante à forma, nunca ao conteúdo", () => {
  it.each([
    ["aspas retas no lugar de curvas", 'Sênior na "Acme Pagamentos"'],
    ["hífen no lugar de travessão", "Ana Maria Exemplo - Engenheira"],
    ["maiúsculas diferentes", "engenheira de software sênior"],
    ["sem acento", "Engenheira de Software Senior"],
    ["palavra quebrada no PDF", "Responsável pelo desenvolvimento da plataforma"],
    ["ligadura do PDF", "plataforma de eficiência operacional"],
  ])("%s → unchecked", (_label, quote) => {
    expect(checkEvidence({ ref: "cv", quote }, cv)).toBe("unchecked");
  });

  it("conteúdo que não está no texto continua sem suporte", () => {
    expect(checkEvidence({ ref: "cv", quote: "Engenheira Staff na Acme" }, cv)).toBe("unsupported");
    expect(checkEvidence({ ref: "cv", quote: "eficiência financeira" }, cv)).toBe("unsupported");
  });
});

describe("motivo do selo", () => {
  function setup() {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    repos.users.ensureId();
    const file = repos.sourceFiles.insert({
      mime: "text/plain",
      size: 1,
      sha256: "s",
      path: "p",
      kind: "cv",
    });
    const run = repos.ingestionRuns.create({
      fileId: file.id,
      provider: "mock",
      models: { document: "h", facts: "h", digest: "s" },
      options: { ocr: false, modelRead: false },
    });
    return { repos, run };
  }
  const skill = (name: string) => ({
    kind: "skill" as const,
    confidence: 0.9,
    data: { name, category: "language" as const },
  });

  it("camada 1 grava o código (sem trecho, curto demais, não encontrado); a camada 2 grava a nota do revisor", () => {
    const { repos, run } = setup();
    const ids = repos.proposals.insertMany(
      run.id,
      [skill("Go"), skill("Rust"), skill("Zig"), skill("Elixir"), skill("Java")],
      [
        null,
        { ref: "cv", quote: "Go" },
        { ref: "cv", quote: "Rust avançado" },
        { ref: "cv", quote: "Engenheira de Software" },
        { ref: "cv", quote: "Acme Pagamentos" },
      ],
    );
    runCheckLayer1(repos, run.id, cv);
    applyCheckResults(repos, [
      {
        proposalId: ids[3] as string,
        status: "unsupported",
        note: "O trecho não cita Elixir.",
      },
      { proposalId: ids[4] as string, status: "supported" },
    ]);
    expect(repos.proposals.listByRun(run.id).map((p) => [p.checkStatus, p.checkReason])).toEqual([
      ["unsupported", { layer: 1, code: "no_evidence" }],
      ["unsupported", { layer: 1, code: "quote_too_short" }],
      ["unsupported", { layer: 1, code: "quote_not_found" }],
      ["unsupported", { layer: 2, code: "reviewer", note: "O trecho não cita Elixir." }],
      ["supported", null],
    ]);
  });
});

describe("migration 0008_check_reason", () => {
  it("upgrade preserva as propostas antigas (sem motivo) e passa a gravar o motivo", () => {
    const db = openDatabase(":memory:");
    migrate(db, { until: "0007_experience_compensation" });
    const repos = createRepos(db);
    repos.users.ensureId();
    const file = repos.sourceFiles.insert({
      mime: "text/plain",
      size: 1,
      sha256: "s",
      path: "p",
      kind: "text",
    });
    const run = repos.ingestionRuns.create({
      fileId: file.id,
      provider: "mock",
      models: { document: "h", facts: "h", digest: "s" },
      options: { ocr: false, modelRead: false },
    });
    const [id] = repos.proposals.insertMany(run.id, [
      { kind: "skill", confidence: 0.9, data: { name: "Go", category: "language" } },
    ]);
    expect(migrate(db, { until: "0008_check_reason" }).applied).toEqual(["0008_check_reason"]);
    const after = createRepos(db);
    expect(after.proposals.listByRun(run.id)[0]?.checkReason).toBeNull();
    after.proposals.setCheckStatus(id as string, "partial", {
      layer: 2,
      code: "reviewer",
      note: "Falta o nível.",
    });
    expect(after.proposals.listByRun(run.id)[0]).toMatchObject({
      checkStatus: "partial",
      checkReason: { layer: 2, code: "reviewer", note: "Falta o nível." },
    });
  });
});
