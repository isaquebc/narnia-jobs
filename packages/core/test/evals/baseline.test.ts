import { describe, expect, it } from "vitest";
import { findRegressions, parseBaselines, serializeBaselines } from "../../src/evals/baseline";

/** F06-14 · bloqueador de regressão: compara a rodada com a linha de base versionada. */
describe("F06/M1 core · linha de base das avaliações", () => {
  const base = parseBaselines(
    JSON.stringify({
      "narnia-chat-title": {
        scores: { schema: 1, judge: 0.8 },
        versionId: "v1",
        updatedAt: "2026-10-14T00:00:00Z",
      },
    }),
  );

  it("queda além da tolerância regride; dentro dela não", () => {
    expect(findRegressions(base, "narnia-chat-title", { schema: 1, judge: 0.76 })).toEqual([]);
    expect(findRegressions(base, "narnia-chat-title", { schema: 0.9, judge: 0.8 })).toEqual([
      { key: "narnia-chat-title", evaluator: "schema", baseline: 1, current: 0.9 },
    ]);
  });

  it("sem linha de base, avaliador novo ou ausente não regride", () => {
    expect(findRegressions(base, "narnia-outro", { schema: 0 })).toEqual([]);
    expect(findRegressions(base, "narnia-chat-title", { novo: 0 })).toEqual([]);
  });

  it("arquivo vazio ou malformado vira linha de base vazia; serialização estável e arredondada", () => {
    expect(parseBaselines("")).toEqual({});
    expect(parseBaselines("[]")).toEqual({});
    const text = serializeBaselines({
      b: { scores: { z: 0.33333, a: 1 }, updatedAt: "t" },
      a: { scores: { x: 1 }, updatedAt: "t" },
    });
    expect(Object.keys(JSON.parse(text))).toEqual(["a", "b"]);
    expect(text).toContain('"a": 1,\n      "z": 0.333');
    expect(parseBaselines(text).b?.scores.z).toBe(0.333);
  });
});
