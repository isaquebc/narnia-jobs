import { describe, expect, it } from "vitest";
import { parseCalibrationItems, scoreCalibration } from "../../src/evals/calibration";

const reply = (text: string) => ({ replies: [text], tools: [] });

describe("calibração dos juízes (pedido do dono, 2026-10-24)", () => {
  it("lê os casos rotulados: absoluto com o rótulo esperado e par com a melhor e a pior", () => {
    const items = parseCalibrationItems(
      [
        "// comentário",
        JSON.stringify({
          id: "limpa",
          kind: "absolute",
          case: "corrigir-cargo",
          defect: "limpa",
          expect: "atende",
          ...reply("ok"),
        }),
        "",
        JSON.stringify({
          id: "par",
          kind: "pair",
          case: "cv-pelo-chat",
          defect: "link-a-mao",
          better: reply("boa"),
          worse: reply("ruim"),
        }),
      ].join("\n"),
    );
    expect(items.map((x) => [x.id, x.kind])).toEqual([
      ["limpa", "absolute"],
      ["par", "pair"],
    ]);
    expect(() => parseCalibrationItems('{"id":"x","kind":"absolute"}')).toThrow(/x/);
  });

  it("absoluto: juiz mais brando que o rótulo é falso positivo, mais duro é falso negativo; dois níveis = grave", () => {
    const r = scoreCalibration([
      { id: "a", kind: "absolute", defect: "limpa", expect: "atende", got: "atende" },
      { id: "b", kind: "absolute", defect: "inventa", expect: "nao_atende", got: "atende" },
      { id: "c", kind: "absolute", defect: "mercado", expect: "parcial", got: "atende" },
      { id: "d", kind: "absolute", defect: "limpa", expect: "atende", got: "parcial" },
      { id: "e", kind: "absolute", defect: "inventa", expect: "nao_atende", got: "nao_atende" },
    ]);
    expect(r.absolute).toMatchObject({ total: 5, right: 2, falsePositives: 2, falseNegatives: 1 });
    expect(r.mistakes.map((m) => [m.id, m.kind, m.severe])).toEqual([
      ["b", "falso positivo", true],
      ["c", "falso positivo", false],
      ["d", "falso negativo", false],
    ]);
  });

  it("par: a melhor tem de ganhar nas duas ordens; preferir a pior é erro, discordância entre as ordens é viés de posição", () => {
    const r = scoreCalibration([
      { id: "p1", kind: "pair", defect: "x", first: "B", swapped: "A" },
      { id: "p2", kind: "pair", defect: "x", first: "A", swapped: "B" },
      { id: "p3", kind: "pair", defect: "x", first: "B", swapped: "B" },
      { id: "p4", kind: "pair", defect: "x", first: "empate", swapped: "empate" },
    ]);
    expect(r.pairs).toMatchObject({ total: 4, right: 1, wrong: 1, positionBias: 1, ties: 1 });
    expect(r.mistakes.map((m) => [m.id, m.kind])).toEqual([
      ["p2", "preferiu a pior"],
      ["p3", "viés de posição"],
      ["p4", "empate"],
    ]);
    // o resumo por defeito mostra onde o juiz erra mais
    expect(r.byDefect.x).toEqual({ total: 4, right: 1 });
  });
});

/**
 * Matriz de confusão (F04-fix-fundamentacao, FF-3): positivo = a resposta tem defeito (rótulo esperado ≠ atende).
 * Por pergunta do juiz (G1…, D1…), quando o item diz quais defeitos tem (`checks`) e o juiz diz quais achou.
 */
describe("calibração · matriz de confusão", () => {
  it("VP, VN, FP e FN no geral, com precisão e recall; e por pergunta", () => {
    const r = scoreCalibration([
      {
        id: "a",
        kind: "absolute",
        defect: "x",
        expect: "nao_atende",
        got: "parcial",
        checks: ["G2"],
        found: ["D4"],
      },
      {
        id: "b",
        kind: "absolute",
        defect: "x",
        expect: "parcial",
        got: "atende",
        checks: ["D1"],
        found: [],
      },
      {
        id: "c",
        kind: "absolute",
        defect: "limpa",
        expect: "atende",
        got: "parcial",
        checks: [],
        found: ["D4"],
      },
      {
        id: "d",
        kind: "absolute",
        defect: "limpa",
        expect: "atende",
        got: "atende",
        checks: [],
        found: [],
      },
    ]);
    // a: tem defeito e o juiz achou algum (VP); b: tem e não achou (FN); c: limpa e achou (FP); d: VN
    expect(r.confusion).toEqual({ tp: 1, tn: 1, fp: 1, fn: 1, precision: 0.5, recall: 0.5 });
    expect(r.byCheck.G2).toEqual({ tp: 0, fp: 0, fn: 1 });
    expect(r.byCheck.D4).toEqual({ tp: 0, fp: 2, fn: 0 });
    expect(r.byCheck.D1).toEqual({ tp: 0, fp: 0, fn: 1 });
  });

  it("os itens aceitam a lista de defeitos esperados", () => {
    const items = parseCalibrationItems(
      '{"id":"n","kind":"absolute","case":"c","defect":"ausencia","expect":"nao_atende","checks":["G2"],"replies":["x"],"tools":[]}',
    );
    expect(items[0]).toMatchObject({ checks: ["G2"] });
  });
});
