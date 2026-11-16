import { describe, expect, it } from "vitest";
import { answerChecks, roleplayChecks } from "../../src/evals/prompt-evaluators/application-locate";

/**
 * F12 · avaliadores por código das respostas do formulário: opção da lista, limite de caracteres, origens que existem
 * no resumo, lacunas e respondidas pela referência; no roleplay, rascunho ancorado, sem clichê, suposições ditas,
 * termos citados e evitados.
 */
const brief = JSON.stringify({ facts: [{ id: "e1" }, { id: "s2" }] });
const questions = JSON.stringify([
  { questionId: "q1", kind: "single_choice", options: ["Sim", "Não"], maxChars: null },
  { questionId: "q2", kind: "multi_choice", options: ["Node", "Go", "Rust"], maxChars: null },
  { questionId: "q3", kind: "text", options: [], maxChars: 20 },
  { questionId: "q4", kind: "text", options: [], maxChars: null },
]);
const input = { questions_json: questions, brief_json: brief };
const ans = (answers: unknown[]) => JSON.stringify({ answers });

describe("F12 · respostas do formulário (answerChecks)", () => {
  it("tudo certo: opção da lista (sem caixa), multipla com ;, no limite, origens do resumo, lacuna e respondida", () => {
    const r = answerChecks({
      input,
      output: ans([
        { questionId: "q1", answer: "sim", origins: ["e1"] },
        { questionId: "q2", answer: "Node; go", origins: [] },
        { questionId: "q3", answer: "Curto", origins: ["s2"] },
        { questionId: "q4", answer: null, gap: "Os dados não dizem." },
      ]),
      reference: { gaps: ["q4"], answered: ["q1"] },
    });
    expect(r).toMatchObject({ label: "passou", explanation: "6 conferências certas" });
  });

  it("cada problema conta: sem resposta, opção fora, longa demais, origem inventada, lacuna e respondida erradas", () => {
    const r = answerChecks({
      input,
      output: ans([
        { questionId: "q1", answer: "Talvez" },
        { questionId: "q2", answer: "Node; Java" },
        { questionId: "q3", answer: "Um texto bem mais longo que vinte" },
        { questionId: "q4", answer: "Algo", origins: ["x9"] },
      ]),
      reference: { gaps: ["q4"], answered: ["q9"] },
    });
    expect(r.label).toBe("falhou");
    for (const m of [
      /q1: opção fora da lista/,
      /q2: opção fora da lista/,
      /q3: \d+ caracteres \(máximo 20\)/,
      /q4: origens fora do resumo \(x9\)/,
      /q4: devia ser lacuna/,
      /q9: devia ter resposta/,
    ])
      expect(r.explanation).toMatch(m);
    expect(r.score).toBe(0);
    const none = answerChecks({ input, output: ans([]) });
    expect(none.explanation).toMatch(/q1: sem resposta nem lacuna/);
  });

  it("sem perguntas (ou JSON quebrado) passa sem conferir nada", () => {
    expect(answerChecks({ input: { questions_json: "[" }, output: "x" })).toMatchObject({
      label: "passou",
      explanation: "sem perguntas no exemplo",
    });
  });
});

describe("F12 · roleplay das perguntas abertas (roleplayChecks)", () => {
  const open = JSON.stringify([
    { questionId: "m1", maxChars: 200 },
    { questionId: "m2", maxChars: 10 },
    { questionId: "m3", maxChars: null },
  ]);
  const base = { questions_json: open, brief_json: brief };

  it("lacuna onde não há âncora, rascunho com origem, sem clichê; suposição dita; termo citado e o evitado ausente", () => {
    const r = roleplayChecks({
      input: base,
      output: ans([
        {
          questionId: "m1",
          answer: "Cuidei da fila de pagamentos na Acme.",
          origins: ["e1"],
          assumptions: ["Gosta de produto."],
        },
        { questionId: "m2", answer: "Filas.", origins: ["s2"] },
        { questionId: "m3", answer: null, gap: "Sem dados." },
      ]),
      reference: {
        gaps: ["m3"],
        answered: ["m1"],
        assumes: ["m1"],
        mention: { m1: ["pagamentos"] },
        avoid: ["Kubernetes"],
      },
    });
    expect(r).toMatchObject({ label: "passou" });
  });

  it("problemas: sem rascunho, longo, sem origem, origem inventada, clichê, lacuna preenchida, suposição e termos", () => {
    const r = roleplayChecks({
      input: base,
      output: ans([
        { questionId: "m1", answer: "Sou apaixonado por Kubernetes desde pequeno.", origins: [] },
        { questionId: "m2", answer: "Texto longo demais", origins: ["zz"] },
        { questionId: "m3", answer: "Preenchi", origins: ["e1"] },
      ]),
      reference: {
        gaps: ["m3"],
        answered: ["m4"],
        assumes: ["m1"],
        mention: { m2: ["filas"] },
        avoid: ["Kubernetes"],
      },
    });
    expect(r.label).toBe("falhou");
    for (const m of [
      /m1: sem origem/,
      /m1: clichê/,
      /m2: 18 caracteres \(máximo 10\)/,
      /m2: origens fora do resumo \(zz\)/,
      /m3: devia ser lacuna/,
      /m4: devia ter resposta/,
      /m1: a motivação não está nos dados/,
      /m2: não cita "filas"/,
      /cita "Kubernetes"/,
    ])
      expect(r.explanation).toMatch(m);
    const empty = roleplayChecks({ input: base, output: ans([{ questionId: "m1", answer: "" }]) });
    expect(empty.explanation).toMatch(/m1: devia ter o rascunho/);
    expect(empty.explanation).toMatch(/m2: sem resposta nem lacuna/);
  });

  it("sem perguntas e JSON quebrado do cadastro: passa sem conferir", () => {
    expect(
      roleplayChecks({ input: { questions_json: "[", person_json: "{" }, output: "x" }).label,
    ).toBe("passou");
  });
});
