import { describe, expect, it } from "vitest";
import { mergeCoverage, reanalysisKind, selectSecondRound } from "../../src/ingest/coverage";
import { estimateRepo, estimateRun, TYPICAL_CONTEXT_CHARS } from "../../src/ingest/estimate-github";
import { addStop, finishReport, markRepo, newRunReport } from "../../src/ingest/report";

const models = { pick: "haiku", repo: "haiku", synthesis: "sonnet", check: "haiku" };

describe("F03/M2 estimate-github (sobre estimateCall)", () => {
  it("rápida/equilibrada: uma chamada por repositório; profunda acrescenta a escolha de arquivos", () => {
    const balanced = estimateRepo({
      fullName: "a/b",
      depth: "balanced",
      contextChars: 20_000,
      models,
    });
    expect(balanced.calls.map((c) => c.name)).toEqual(["repo"]);
    const deep = estimateRepo({
      fullName: "a/b",
      depth: "deep",
      contextChars: 40_000,
      treeChars: 4_000,
      models,
    });
    expect(deep.calls.map((c) => c.name)).toEqual(["pick", "repo"]);
    expect(deep.calls[0]?.model).toBe("haiku");
    expect(deep.tokens).toBeGreaterThan(balanced.tokens);
  });

  it("execução soma repositórios, síntese e revisor com overhead; sem tamanho usa o típico da profundidade", () => {
    const est = estimateRun({
      depth: "balanced",
      models,
      checkEnabled: true,
      metricsChars: 1_000,
      repos: [{ fullName: "a/b", contextChars: 20_000 }, { fullName: "a/c" }],
    });
    expect(est.perRepo).toHaveLength(2);
    expect(est.perRepo[1]?.tokens).toBe(
      estimateRepo({
        fullName: "a/c",
        depth: "balanced",
        contextChars: TYPICAL_CONTEXT_CHARS.balanced,
        models,
      }).tokens,
    );
    expect(est.synthesisTokens).toBeGreaterThan(0);
    expect(est.checkTokens).toBeGreaterThan(0);
    expect(est.totalTokens).toBe(
      est.perRepo.reduce((n, r) => n + r.tokens, 0) + est.synthesisTokens + est.checkTokens,
    );
    expect(
      estimateRun({
        depth: "balanced",
        models,
        checkEnabled: false,
        metricsChars: 0,
        repos: [{ fullName: "a/b" }],
      }).checkTokens,
    ).toBe(0);
  });

  it("incremental (relatório + diff) sai mais barata que a análise completa", () => {
    const full = estimateRepo({
      fullName: "a/b",
      depth: "balanced",
      contextChars: TYPICAL_CONTEXT_CHARS.balanced,
      models,
    });
    const inc = estimateRepo({
      fullName: "a/b",
      depth: "balanced",
      kind: "incremental",
      contextChars: 4_000,
      models,
    });
    expect(inc.tokens).toBeLessThan(full.tokens);
  });
});

describe("F03/M2 relatório de execução (F03-3 §2)", () => {
  it("estimado × real por repositório, paradas, pulados por orçamento e totais", () => {
    let r = newRunReport({
      model: "haiku",
      budget: 30_000,
      startedAt: "2026-10-09T10:00:00Z",
      repos: [
        { fullName: "a/b", estimatedTokens: 10_000 },
        { fullName: "a/c", estimatedTokens: 10_000 },
        { fullName: "a/d", estimatedTokens: 10_000 },
      ],
    });
    expect(r.repos.every((x) => x.status === "pending")).toBe(true);
    r = markRepo(r, "a/b", { status: "done", usedTokens: 12_000 });
    r = markRepo(r, "a/c", { status: "done", usedTokens: 26_000 });
    r = addStop(r, { at: "2026-10-09T10:05:00Z", reason: "orçamento", usedTokens: 38_000 });
    r = markRepo(r, "a/d", { status: "skipped_budget", usedTokens: 0, stoppedReason: "orçamento" });
    r = finishReport(r, { finishedAt: "2026-10-09T10:06:00Z", synthesis: "Resumo" });
    expect(r.totals).toEqual({ estimated: 30_000, used: 38_000 });
    expect(r.skipped).toEqual(["a/d"]);
    expect(r.stops).toHaveLength(1);
    expect(r.synthesis).toBe("Resumo");
    expect(() => markRepo(r, "x/y", { status: "done", usedTokens: 1 })).toThrow();
  });
});

describe("F03/M2 cobertura, incremental e segunda rodada (F03-3 §7)", () => {
  const candidates = [
    { path: "package.json", size: 1, category: "manifest" as const },
    { path: "src/index.ts", size: 1, category: "entrypoint" as const },
    { path: "src/a.ts", size: 1, category: "sample" as const },
    { path: "test/a.test.ts", size: 1, category: "test" as const },
  ];
  const coverage = { files: ["package.json", "src/index.ts"], topics: ["api"] };

  it("tipo da reanálise: sem análise → completa; SHA novo → incremental; mesmo SHA → segunda rodada", () => {
    expect(reanalysisKind({ previous: null, headSha: "x" })).toBe("full");
    expect(reanalysisKind({ previous: { headSha: "a" }, headSha: "b" })).toBe("incremental");
    expect(reanalysisKind({ previous: { headSha: "a" }, headSha: "a" })).toBe("second_round");
  });

  it("cobrir escolhe só fora da cobertura; aprofundar só dentro; respeita o máximo", () => {
    expect(
      selectSecondRound({ kind: "cover", candidates, coverage, max: 8 }).map((c) => c.path),
    ).toEqual(["src/a.ts", "test/a.test.ts"]);
    expect(
      selectSecondRound({ kind: "deepen", candidates, coverage, max: 8 }).map((c) => c.path),
    ).toEqual(["package.json", "src/index.ts"]);
    expect(selectSecondRound({ kind: "cover", candidates, coverage, max: 1 })).toHaveLength(1);
  });

  it("mergeCoverage une arquivos e temas sem repetir", () => {
    expect(
      mergeCoverage(coverage, {
        files: ["src/a.ts", "package.json"],
        topics: ["api", "pagamentos"],
      }),
    ).toEqual({
      files: ["package.json", "src/a.ts", "src/index.ts"],
      topics: ["api", "pagamentos"],
    });
  });
});
