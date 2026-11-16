import { describe, expect, it } from "vitest";
import { interviewFramesChecks, interviewReportChecks } from "../../src";

/**
 * F13/M5 · avaliadores por código do relatório da entrevista: uma leitura por anotação, três treinos, ficha de cada
 * pessoa, notas de 0 a 10 com justificativa (e na faixa esperada) e turnos que existem; quadros todos descritos.
 */
const transcript =
  "[1] Entrevistadora: Conte um projeto.\n[2] Candidato: Fiz uma fila.\n[3] Entrevistadora: Ok.";
const brief = JSON.stringify({
  events: [
    { key: "n1", type: "note" },
    { key: "r1", type: "reaction" },
  ],
  persons: [{ key: "p1" }, { key: "p2" }],
});
const score = (points: unknown, turns = [2]) => ({
  points,
  reason: "Respondeu com exemplo.",
  turns,
});
const good = {
  notes: [{ event: "n1" }],
  drills: [{}, {}, {}],
  people: [{ person: "p1" }, { person: "p2" }],
  shouldNotHaveSaid: [{ turn: 2 }],
  worked: [{ turn: 2 }],
  answers: [{ questionTurn: 1, answerTurns: [2] }],
  scores: { completeness: score(7), objectivity: score(8), clarity: score(6) },
};
const input = { brief_json: brief, transcript };

describe("F13/M5 · avaliadores da entrevista", () => {
  it("relatório completo passa; texto que não é JSON falha", () => {
    expect(interviewReportChecks({ output: JSON.stringify(good), input })).toMatchObject({
      label: "passou",
      score: 1,
    });
    expect(interviewReportChecks({ output: "não sei", input }).label).toBe("falhou");
  });

  it("anotação sem leitura, treinos errados, pessoa sem ficha e turno inexistente somam problemas", () => {
    const r = interviewReportChecks({
      output: {
        ...good,
        notes: [],
        drills: [{}],
        people: [{ person: "p1" }],
        worked: [{ turn: 9 }],
        answers: [{ questionTurn: 1, answerTurns: [7] }],
      },
      input,
    });
    expect(r.label).toBe("falhou");
    expect(r.explanation).toMatch(/anotações sem leitura: n1/);
    expect(r.explanation).toMatch(/1 treinos/);
    expect(r.explanation).toMatch(/sem ficha: p2/);
    expect(r.explanation).toMatch(/turnos inexistentes: .*9.*7/);
    expect(r.score).toBe(0);
  });

  it("notas: ausente, fora de 0–10, sem justificativa, fora da faixa esperada ou com turno inexistente", () => {
    const r = interviewReportChecks({
      output: {
        ...good,
        scores: {
          completeness: score(11),
          objectivity: { points: 5, reason: " ", turns: [2] },
          clarity: score(9, [42]),
        },
      },
      input,
      reference: { scores: { clarity: [2, 5] } },
    });
    expect(r.explanation).toMatch(/nota completeness ausente ou fora de 0–10/);
    expect(r.explanation).toMatch(/nota objectivity sem justificativa/);
    expect(r.explanation).toMatch(/nota clarity = 9 \(esperado 2–5\)/);
    expect(r.explanation).toMatch(/turnos inexistentes: 42/);
    const sem = interviewReportChecks({ output: { ...good, scores: undefined }, input });
    expect(sem.explanation).toMatch(/nota clarity ausente/);
  });

  it("sem resumo legível nem transcrição, só as checagens de forma", () => {
    const r = interviewReportChecks({
      output: { ...good, worked: [{ turn: 99 }] },
      input: { brief_json: "{quebrado", transcript: "" },
    });
    expect(r.label).toBe("passou");
    expect(interviewReportChecks({ output: { ...good, drills: undefined } }).label).toBe("falhou");
  });

  it("quadros: um por arquivo pedido; faltou algum, falha com a fração; lista ilegível não cobra nada", () => {
    const asked = JSON.stringify([{ file: "a.jpg" }, { file: "b.jpg" }]);
    expect(
      interviewFramesChecks({
        output: { frames: [{ file: "a.jpg" }, { file: "b.jpg" }] },
        input: { frames_json: asked },
      }),
    ).toMatchObject({ label: "passou", explanation: "2 quadros descritos" });
    expect(
      interviewFramesChecks({
        output: { frames: [{ file: "a.jpg" }] },
        input: { frames_json: asked },
      }),
    ).toMatchObject({ label: "falhou", score: 0.5 });
    expect(interviewFramesChecks({ output: "nada", input: { frames_json: "[" } }).label).toBe(
      "passou",
    );
  });
});
