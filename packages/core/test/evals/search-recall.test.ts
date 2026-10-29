import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createChatTools } from "../../src/chat/tools";
import { createRepos, migrate, openDatabase } from "../../src/db";
import {
  factSearchRecall,
  parseRecallCases,
  type RecallSearch,
} from "../../src/evals/search-recall";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * Benchmark de recall da busca de fatos (F04-fix-fundamentacao, R0, 2026-10-29): perguntas como o recrutador faria e
 * os fatos que deveriam voltar. Mede quanto a `fact_search` perde por tipo (termo exato, termos agrupados, tradução,
 * sinônimo, proximidade de sentido); é a linha de partida da R1 (busca) e da R6 (RAG).
 */
const CASES = `{"id":"a","category":"exato","query":"Kubernetes","expected":[{"kind":"skill","match":"Kubernetes"},{"kind":"achievement","match":"migração"}]}
{"id":"b","category":"agrupado","query":"x y","expected":[{"kind":"skill","match":"Mentoria"}]}`;

describe("recall da busca de fatos", () => {
  it("lê os casos e recusa linha inválida com o número dela", () => {
    expect(parseRecallCases(CASES).map((c) => c.id)).toEqual(["a", "b"]);
    expect(() => parseRecallCases('{"id":"x"}')).toThrow(/linha 1/);
  });

  it("recall por caso, por tipo e geral; o que faltou sai pelo rótulo; acento e caixa não contam", async () => {
    const search: RecallSearch = async (q) =>
      q === "Kubernetes"
        ? [
            { kind: "skill", line: "kubernetes (nível 3)" },
            { kind: "experience", line: "Acme · Migração" },
          ]
        : [];
    const r = await factSearchRecall(parseRecallCases(CASES), search);
    expect(r.cases).toEqual([
      { id: "a", category: "exato", recall: 0.5, found: 1, missing: ["achievement: migração"] },
      { id: "b", category: "agrupado", recall: 0, found: 0, missing: ["skill: Mentoria"] },
    ]);
    expect(r.byCategory).toEqual({ exato: 0.5, agrupado: 0 });
    expect(r.overall).toBeCloseTo(1 / 3);
  });

  it("o dataset do repositório roda contra a fact_search real da fixture", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    seedFixture(repos, "engineer");
    const tools = createChatTools(repos, { ingest: {} as never });
    const cases = parseRecallCases(
      readFileSync(new URL("../../../../evals/search/recall.jsonl", import.meta.url), "utf8"),
    );
    expect(cases.length).toBeGreaterThanOrEqual(20);
    const r = await factSearchRecall(cases, async (q) => (await tools["fact.search"]({ q })).items);
    // termo exato sempre volta
    expect(r.cases.find((c) => c.id === "kubernetes")?.recall).toBe(1);
    db.close();
  });
});
