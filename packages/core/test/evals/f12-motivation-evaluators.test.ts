import { describe, expect, it } from "vitest";
import { roleplayChecks } from "../../src/evals/prompt-evaluators/application-locate";
import { genderMarks } from "../../src/evals/prompt-evaluators/lib";
import { motivationChecks } from "../../src/evals/prompt-evaluators/motivations";

/** F12-23 · avaliadores das motivações do perfil e do tratamento nas suposições do roleplay. */
const out = (o: unknown) => ({ messages: [{ role: "assistant", content: JSON.stringify(o) }] });
const brief = JSON.stringify({
  experiences: [{ id: "e1" }, { id: "e2" }],
  achievements: [{ id: "a1" }],
});

describe("F12-23 · marca de gênero", () => {
  it("neutro não aceita palavra com gênero; feminino não aceita a masculina e vice-versa", () => {
    expect(genderMarks("Gosto de ser dona dos serviços.", "neutro")).toEqual(["dona"]);
    expect(genderMarks("Gosto de cuidar dos serviços de ponta a ponta.", "neutro")).toEqual([]);
    expect(genderMarks("Sou dona dos serviços e fico motivada.", "feminino")).toEqual([]);
    expect(genderMarks("Sou dono dos serviços.", "feminino")).toEqual(["dono"]);
    expect(genderMarks("Fico realizada com times pequenos.", "masculino")).toEqual(["realizada"]);
    // substantivo comum não conta ("donativo", "motivação")
    expect(genderMarks("A motivação vem do produto.", "neutro")).toEqual([]);
  });
});

describe("F12-23 · motivações sugeridas", () => {
  const input = {
    brief_json: brief,
    address: "neutro",
    count: "3",
    accepted_json: JSON.stringify(["Quero continuar trabalhando com pagamentos."]),
    refused_json: JSON.stringify(["Gosto de ser dona dos serviços de ponta a ponta."]),
  };

  it("passa: até `quantas`, curtas, com origem do resumo, sem repetir aceitas nem recusadas, no tratamento", () => {
    const ok = out({
      motivations: [
        { text: "Gosto de resolver problemas de desempenho.", origins: ["a1"] },
        { text: "Quero ajudar outras pessoas do time a crescer.", origins: ["e2"] },
      ],
    });
    expect(motivationChecks({ input, output: ok })).toMatchObject({ label: "passou", score: 1 });
  });

  it("acusa excesso, frase longa, sem origem ou de fora do resumo, repetida, gênero e tema evitado", () => {
    const bad = out({
      motivations: [
        { text: "Quero continuar trabalhando com pagamentos!", origins: ["e1"] },
        { text: "Sou apaixonada por desafios.", origins: ["e1"] },
        { text: "x".repeat(130), origins: ["e1"] },
        { text: "Gosto de produto.", origins: [] },
        { text: "Gosto de dados.", origins: ["e9"] },
      ],
    });
    const r = motivationChecks({ input, output: bad, reference: { avoid: ["startup"] } });
    expect(r.label).toBe("falhou");
    expect(r.explanation).toMatch(/5 frases \(máximo 3\)/);
    expect(r.explanation).toMatch(/repete uma aceita ou recusada/);
    expect(r.explanation).toMatch(/gênero/);
    expect(r.explanation).toMatch(/130 caracteres/);
    expect(r.explanation).toMatch(/sem origem/);
    expect(r.explanation).toMatch(/fora do resumo \(e9\)/);
  });

  it("nenhuma frase quando os dados sustentam: falha (com `min` na referência)", () => {
    const r = motivationChecks({ input, output: out({ motivations: [] }), reference: { min: 2 } });
    expect(r.label).toBe("falhou");
    expect(r.explanation).toMatch(/0 frases \(mínimo 2\)/);
  });
});

describe("F12-23 · suposições do roleplay no tratamento do cadastro", () => {
  const input = {
    brief_json: brief,
    person_json: JSON.stringify({ address: "neutro", motivations: [] }),
    questions_json: JSON.stringify([{ questionId: "q1", maxChars: null }]),
  };
  it("suposição com gênero, sem tratamento escolhido, falha", () => {
    const answer = (assumptions: string[]) =>
      out({
        answers: [
          {
            questionId: "q1",
            answer: "Na Acme, liderei a migração.",
            assumptions,
            origins: ["e1"],
            gap: null,
          },
        ],
      });
    expect(
      roleplayChecks({ input, output: answer(["Que você gosta de cuidar dos serviços."]) }).label,
    ).toBe("passou");
    const r = roleplayChecks({
      input,
      output: answer(["Que você gosta de ser dona dos serviços."]),
    });
    expect(r.label).toBe("falhou");
    expect(r.explanation).toMatch(/gênero/);
  });

  it("motivação aceita no perfil não volta como suposição", () => {
    const withMotivation = {
      ...input,
      person_json: JSON.stringify({
        address: "feminino",
        motivations: ["Quero continuar trabalhando com pagamentos."],
      }),
    };
    const r = roleplayChecks({
      input: withMotivation,
      output: out({
        answers: [
          {
            questionId: "q1",
            answer: "Na Acme, liderei a migração.",
            assumptions: ["Que você quer continuar trabalhando com pagamentos."],
            origins: ["e1"],
            gap: null,
          },
        ],
      }),
    });
    expect(r.label).toBe("falhou");
    expect(r.explanation).toMatch(/já está nas motivações/);
  });
});
