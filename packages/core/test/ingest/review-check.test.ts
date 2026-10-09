import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import {
  applyCheckResults,
  buildCheckBatch,
  checkEvidence,
  runCheckLayer1,
} from "../../src/ingest/review-check";

const sources = {
  cv: "Ana Maria Exemplo\nEngenheira de Software Sênior na Acme Pagamentos\n  desde 2023.",
  "README.md": "# API de pagamentos\nServiço em Node.js 22 e PostgreSQL.",
};

describe("F03/M2 review-check, camada 1 sem tokens (F03-3 §8)", () => {
  it("trecho literal presente → unchecked (fica para a camada 2)", () => {
    expect(
      checkEvidence(
        { ref: "cv", quote: "Engenheira de Software Sênior na Acme Pagamentos" },
        sources,
      ),
    ).toBe("unchecked");
  });

  it("normaliza espaços e quebras de linha", () => {
    expect(checkEvidence({ ref: "cv", quote: "Acme Pagamentos desde   2023." }, sources)).toBe(
      "unchecked",
    );
  });

  it("trecho ausente, vazio ou sem evidência → unsupported", () => {
    expect(checkEvidence({ ref: "cv", quote: "Engenheira Staff na Zeta" }, sources)).toBe(
      "unsupported",
    );
    expect(checkEvidence({ ref: "cv", quote: "  " }, sources)).toBe("unsupported");
    expect(checkEvidence(null, sources)).toBe("unsupported");
  });

  it("ref desconhecida: procura em todas as fontes enviadas (o modelo erra o nome da fonte)", () => {
    expect(checkEvidence({ ref: "README", quote: "Node.js 22 e PostgreSQL" }, sources)).toBe(
      "unchecked",
    );
  });

  it("runCheckLayer1 marca as propostas pendentes do run; buildCheckBatch só leva as unchecked; applyCheckResults grava a camada 2", () => {
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
    const ids = repos.proposals.insertMany(
      run.id,
      [
        { kind: "skill", confidence: 0.9, data: { name: "Node.js", category: "framework" } },
        { kind: "skill", confidence: 0.9, data: { name: "Rust", category: "language" } },
        { kind: "skill", confidence: 0.9, data: { name: "Go", category: "language" } },
      ],
      [{ ref: "README.md", quote: "Node.js 22" }, { ref: "cv", quote: "Rust avançado" }, null],
    );
    expect(runCheckLayer1(repos, run.id, sources)).toEqual({ unchecked: 1, unsupported: 2 });
    const batch = buildCheckBatch(repos.proposals.listByRun(run.id));
    expect(batch).toEqual([
      { proposalId: ids[0], kind: "skill", claim: "skill: Node.js", quote: "Node.js 22" },
    ]);
    applyCheckResults(repos, [
      { proposalId: ids[0] as string, status: "supported" },
      { proposalId: "fora-do-run", status: "partial" },
    ]);
    expect(repos.proposals.listByRun(run.id).map((p) => p.checkStatus)).toEqual([
      "supported",
      "unsupported",
      "unsupported",
    ]);
  });
});
