import { describe, expect, it } from "vitest";
import {
  type ApprovedCase,
  pairOutcome,
  pairwiseDecision,
  parseApproved,
  serializeApproved,
} from "../../src/evals/pairwise";

/** F04-avaliacoes M7 (AV-5, AV-6) · gate pairwise: prompt novo só substitui o aprovado se for upgrade. */
describe("AV-5 · resultado de um par julgado duas vezes com a ordem trocada", () => {
  // 1ª chamada: A = aprovada, B = candidata; 2ª: A = candidata, B = aprovada
  it("as duas ordens concordam: vale o veredito", () => {
    expect(pairOutcome("B", "A")).toBe("ganhou");
    expect(pairOutcome("A", "B")).toBe("perdeu");
    expect(pairOutcome("empate", "empate")).toBe("empate");
  });

  it("discordância (viés de posição) ou um empate: conta como empate", () => {
    expect(pairOutcome("A", "A")).toBe("empate");
    expect(pairOutcome("B", "B")).toBe("empate");
    expect(pairOutcome("B", "empate")).toBe("empate");
    expect(pairOutcome("empate", "B")).toBe("empate");
  });
});

describe("AV-5 · regra de passagem", () => {
  const cases = (...o: Array<"ganhou" | "perdeu" | "empate">) =>
    o.map((outcome, i) => ({ exampleId: `c${i}`, outcome, explanation: "" }));

  it("passa só com mais vitórias que derrotas (empates não contam)", () => {
    expect(pairwiseDecision(cases("ganhou", "ganhou", "perdeu", "empate"))).toMatchObject({
      passed: true,
      wins: 2,
      losses: 1,
      ties: 1,
    });
    expect(pairwiseDecision(cases("ganhou", "perdeu", "empate")).passed).toBe(false);
  });

  it("só empatar não é upgrade", () => {
    const d = pairwiseDecision(cases("empate", "empate"));
    expect(d.passed).toBe(false);
    expect(d.reason).toMatch(/upgrade/);
  });

  it("correção de um caso: o corrigido é ganho e nenhum outro é perdido", () => {
    expect(pairwiseDecision(cases("ganhou", "empate", "empate"), ["c0"]).passed).toBe(true);
    const lost = pairwiseDecision(cases("ganhou", "perdeu", "ganhou"), ["c0"]);
    expect(lost.passed).toBe(false);
    expect(lost.reason).toMatch(/c1/);
    const notWon = pairwiseDecision(cases("empate", "ganhou", "ganhou"), ["c0"]);
    expect(notWon.passed).toBe(false);
    expect(notWon.reason).toMatch(/c0/);
  });
});

describe("AV-6 · saídas aprovadas em evals/approved/<prompt>.jsonl", () => {
  const a: ApprovedCase = {
    exampleId: "b",
    versionId: "v1",
    commit: "abc1234",
    approvedAt: "2026-10-21T00:00:00Z",
    output: { texto: "olá" },
    evaluations: [{ name: "idioma", kind: "CODE", label: "passou", score: 1, explanation: "" }],
  };
  const b: ApprovedCase = { ...a, exampleId: "a", output: "saída" };

  it("uma linha por caso, ordenada pelo id (diff estável no git), e volta igual", () => {
    const text = serializeApproved([a, b]);
    expect(text.trim().split("\n")).toHaveLength(2);
    expect(text.indexOf('"exampleId":"a"')).toBeLessThan(text.indexOf('"exampleId":"b"'));
    expect(text.endsWith("\n")).toBe(true);
    expect(parseApproved(text)).toEqual([b, a]);
  });

  it("arquivo vazio ou ausente: nenhum caso aprovado; linha inválida é ignorada", () => {
    expect(parseApproved(null)).toEqual([]);
    expect(parseApproved("\n")).toEqual([]);
    expect(parseApproved(`não é json\n${JSON.stringify(a)}\n{"x":1}\n`)).toEqual([a]);
  });
});
