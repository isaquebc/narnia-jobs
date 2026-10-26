import { describe, expect, it } from "vitest";
import {
  type ApprovedCase,
  depsChanged,
  majorityOutcome,
  noiseMargin,
  type PairOutcome,
  pairOutcome,
  pairwiseDecision,
  parseApproved,
  serializeApproved,
  tallySamples,
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

/**
 * Gate robusto (2026-10-25): uma amostra por caso oscilava mais do que o efeito medido (a mesma versão do recrutador
 * perdeu de 4 a 1 para uma amostra anterior dela mesma). Pairwise só nos casos cujas dependências mudaram, maioria de
 * várias amostras por caso e margem medida pelo teste A contra A.
 */
describe("gate robusto · maioria das amostras de um caso", () => {
  it("vale o saldo de vitórias e derrotas; saldo zero é empate", () => {
    expect(majorityOutcome(["ganhou", "empate", "ganhou"])).toBe("ganhou");
    expect(majorityOutcome(["ganhou", "perdeu", "empate"])).toBe("empate");
    expect(majorityOutcome(["perdeu", "perdeu", "ganhou"])).toBe("perdeu");
    expect(majorityOutcome(["empate"])).toBe("empate");
    expect(majorityOutcome([])).toBe("empate");
  });
});

describe("gate robusto · margem pelo ruído do A contra A", () => {
  it("sem medição ou sem ruído: basta ganhar mais do que perder (margem 1)", () => {
    expect(noiseMargin(undefined, 13)).toBe(1);
    expect(noiseMargin(0, 13)).toBe(1);
  });

  it("com ruído: um desvio padrão do saldo que o acaso produz (raiz de casos decisivos esperados)", () => {
    expect(noiseMargin(0.4, 13)).toBe(3); // √5,2 ≈ 2,3
    expect(noiseMargin(0.4, 2)).toBe(1); // √0,8 ≈ 0,9
    expect(noiseMargin(1, 9)).toBe(3);
  });

  it("a decisão exige saldo ≥ margem", () => {
    const cases = (w: number, l: number) => [
      ...Array.from({ length: w }, (_, i) => ({
        exampleId: `w${i}`,
        outcome: "ganhou" as const,
        explanation: "",
      })),
      ...Array.from({ length: l }, (_, i) => ({
        exampleId: `l${i}`,
        outcome: "perdeu" as const,
        explanation: "",
      })),
    ];
    expect(pairwiseDecision(cases(3, 1), [], 3).passed).toBe(false);
    expect(pairwiseDecision(cases(3, 1), [], 3).reason).toMatch(/margem do ruído: 3/);
    expect(pairwiseDecision(cases(4, 1), [], 3).passed).toBe(true);
    expect(pairwiseDecision(cases(2, 1)).passed).toBe(true);
  });
});

describe("gate robusto · contagem por amostra (decisão do dono 2026-10-26)", () => {
  it("com amostras, o placar soma cada amostra: a maioria por caso jogava informação fora", () => {
    const cases = [
      {
        exampleId: "a",
        outcome: "perdeu" as const,
        explanation: "",
        samples: ["ganhou", "perdeu", "perdeu"] as PairOutcome[],
      },
      {
        exampleId: "b",
        outcome: "ganhou" as const,
        explanation: "",
        samples: ["ganhou", "ganhou", "empate"] as PairOutcome[],
      },
    ];
    expect(tallySamples(cases)).toEqual({ wins: 3, losses: 2, ties: 1 });
    expect(pairwiseDecision(cases, [], 1, "nao_inferior")).toMatchObject({
      passed: true,
      wins: 3,
      losses: 2,
      ties: 1,
    });
    expect(pairwiseDecision(cases, [], 2)).toMatchObject({ passed: false, wins: 3, losses: 2 });
    expect(pairwiseDecision(cases, [], 2).reason).toMatch(/por amostra/);
  });

  it("caso sem amostras conta uma vez, pelo resultado dele", () => {
    expect(
      tallySamples([
        { exampleId: "a", outcome: "ganhou", explanation: "" },
        { exampleId: "b", outcome: "empate", explanation: "", samples: ["perdeu", "empate"] },
      ]),
    ).toEqual({ wins: 1, losses: 1, ties: 1 });
  });
});

describe("gate robusto · dependências do caso", () => {
  it("mudou se algum prompt de qualquer um dos lados tem hash diferente ou falta; sem registro, mudou", () => {
    expect(depsChanged({ a: "1", b: "2" }, { b: "2", a: "1" })).toBe(false);
    expect(depsChanged({ a: "1" }, { a: "9" })).toBe(true);
    expect(depsChanged({ a: "1" }, { a: "1", b: "2" })).toBe(true);
    expect(depsChanged(undefined, { a: "1" })).toBe(true);
  });

  it("a aprovada guarda as dependências e as amostras (ida e volta pelo arquivo)", () => {
    const c: ApprovedCase = {
      exampleId: "x",
      versionId: "v",
      commit: null,
      approvedAt: "t",
      output: { replies: ["oi"] },
      evaluations: [],
      deps: { "narnia-recrutador": "h1" },
    };
    expect(parseApproved(serializeApproved([c]))[0]?.deps).toEqual({ "narnia-recrutador": "h1" });
    const { deps: _, ...old } = c;
    expect(parseApproved(serializeApproved([old]))[0]?.deps).toBeUndefined();
  });
});

/**
 * Não-inferioridade (decisão do dono, 2026-10-25): mudança que acrescenta funcionalidade (`--feature`) não precisa
 * ganhar nos casos antigos afetados; basta não perder além do ruído (derrotas − vitórias < margem).
 */
describe("gate robusto · não-inferioridade (--feature)", () => {
  const mk = (w: number, l: number, t = 0) =>
    [
      ...Array.from({ length: w }, () => "ganhou" as const),
      ...Array.from({ length: l }, () => "perdeu" as const),
      ...Array.from({ length: t }, () => "empate" as const),
    ].map((outcome, i) => ({ exampleId: `c${i}`, outcome, explanation: "" }));

  it("empates e derrotas dentro da margem passam; além dela, não", () => {
    expect(pairwiseDecision(mk(0, 0, 2), [], 2, "nao_inferior").passed).toBe(true);
    expect(pairwiseDecision(mk(0, 1, 1), [], 2, "nao_inferior")).toMatchObject({
      passed: true,
      wins: 0,
      losses: 1,
    });
    expect(pairwiseDecision(mk(0, 2), [], 2, "nao_inferior").passed).toBe(false);
    expect(pairwiseDecision(mk(0, 2), [], 2, "nao_inferior").reason).toMatch(/inferior/);
    expect(pairwiseDecision([], [], 1, "nao_inferior").passed).toBe(true);
  });
});
