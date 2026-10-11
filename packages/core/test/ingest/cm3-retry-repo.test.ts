import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { finishReport, markRepo, newRunReport, reopenRepo } from "../../src/ingest/report";

/** Plano de comunicação C4: refazer um repositório falho na mesma execução reabre a linha e a síntese. */
describe("CM3 · reopenRepo", () => {
  const base = () => {
    let r = newRunReport({
      model: "haiku",
      budget: 10_000,
      startedAt: null,
      repos: [
        { fullName: "a/x", estimatedTokens: 1000 },
        { fullName: "a/y", estimatedTokens: 1000 },
      ],
    });
    r = markRepo(r, "a/x", { status: "done", usedTokens: 900 });
    r = markRepo(r, "a/y", { status: "error", usedTokens: 300, stoppedReason: "limite de turnos" });
    return finishReport(r, {
      finishedAt: "2026-10-11T10:00:00.000Z",
      synthesis: "ok",
      extraUsedTokens: 100,
    });
  };

  it("volta a linha para pendente, zera uso e motivo, e reabre a síntese", () => {
    const r = reopenRepo(base(), "a/y");
    const y = r.repos.find((x) => x.fullName === "a/y");
    expect(y?.status).toBe("pending");
    expect(y?.usedTokens).toBe(0);
    expect(y?.stoppedReason).toBeUndefined();
    expect(r.finishedAt).toBeNull();
    expect(r.synthesis).toBeNull();
    expect(r.repos.find((x) => x.fullName === "a/x")?.status).toBe("done");
  });

  it("recusa repositório fora da execução", () => {
    expect(() => reopenRepo(base(), "a/z")).toThrow(/fora da execução/);
  });
});

describe("CM3 · ingestionRuns.listChildren", () => {
  it("lista as reanálises de uma execução pela origem", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const budget = {
      amount: 1000,
      unit: "thousand" as const,
      depth: "quick" as const,
      perRepo: 1000,
      reserve: { synthesis: 0, check: 0 },
    };
    const parent = repos.ingestionRuns.createGithub({
      provider: "mock",
      mode: "private",
      depth: "quick",
      model: "haiku",
      params: { repos: ["a/x"] },
      budget,
    });
    const child = repos.ingestionRuns.createGithub({
      provider: "mock",
      mode: "private",
      depth: "quick",
      model: "haiku",
      params: { repos: ["a/x"] },
      budget,
      parentRunId: parent.id,
    });
    expect(repos.ingestionRuns.listChildren(parent.id).map((r) => r.id)).toEqual([child.id]);
    expect(repos.ingestionRuns.listChildren(child.id)).toEqual([]);
  });
});
