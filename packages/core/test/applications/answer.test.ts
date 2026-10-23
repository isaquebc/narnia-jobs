import type { ApplicationQuestion } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import {
  answerableQuestions,
  assembleAnswers,
  detectFormLocale,
} from "../../src/applications/answer";

/**
 * F12/M4 · respostas sugeridas (§4.6-3): só as perguntas que o modelo responde (nunca consentimento, autodeclaração,
 * anexo nem campo óbvio); a conferência por código recusa opção fora da lista, corta no limite de caracteres e só
 * aceita origens que existem no resumo. Sem dado, fica a lacuna, nunca uma resposta inventada.
 */
const q = (id: string, over: Partial<ApplicationQuestion> = {}): ApplicationQuestion => ({
  id,
  question: id,
  kind: "short_text",
  options: [],
  required: false,
  maxChars: null,
  fieldRefs: ["f1"],
  section: null,
  profileField: null,
  topic: null,
  source: "model",
  ...over,
});

const resolve = (short: string) =>
  ({ e1: { kind: "experience", id: "exp-1" }, a2: { kind: "achievement", id: "ach-2" } })[short] ??
  null;

describe("F12/M4 · respostas", () => {
  it("o modelo só recebe o que é dele", () => {
    const qs = [
      q("q1", { profileField: "email" }),
      q("q2", { kind: "consent" }),
      q("q3", { kind: "self_declaration", topic: "race" }),
      q("q4", { kind: "file" }),
      q("q5", { kind: "long_text" }),
      q("q6", { kind: "choice", options: [{ value: "1", label: "Sim" }] }),
    ];
    expect(answerableQuestions(qs).map((x) => x.id)).toEqual(["q5", "q6"]);
  });

  it("idioma do formulário pelas perguntas", () => {
    expect(
      detectFormLocale([q("Why do you want to join us?"), q("Are you authorized to work?")]),
    ).toBe("en-US");
    expect(
      detectFormLocale([q("Por que você quer trabalhar aqui?"), q("Qual a sua pretensão?")]),
    ).toBe("pt-BR");
  });

  it("confere opção, limite, origens e lacuna", () => {
    const qs = [
      q("q1", { kind: "long_text", maxChars: 60 }),
      q("q2", {
        kind: "choice",
        options: [
          { value: "a", label: "Até 30 dias" },
          { value: "b", label: "Imediato" },
        ],
      }),
      q("q3", {
        kind: "choice",
        options: [
          { value: "x", label: "Sim" },
          { value: "y", label: "Não" },
        ],
      }),
      q("q4", { kind: "number" }),
      q("q5", { kind: "yes_no" }),
      q("q6", {
        kind: "multi_choice",
        options: [
          { value: "1", label: "Java" },
          { value: "2", label: "Go" },
          { value: "3", label: "Kafka" },
        ],
      }),
      q("q7"),
    ];
    const r = assembleAnswers(
      qs,
      {
        answers: [
          {
            questionId: "q1",
            answer:
              "Liderei a migração para Kafka na Acme. Reduzi a latência em 70% e formei o time de plataforma.",
            origins: ["e1", "a2", "zz9"],
            gap: null,
          },
          { questionId: "q2", answer: "imediato", origins: [], gap: null },
          { questionId: "q3", answer: "Talvez", origins: [], gap: null },
          {
            questionId: "q4",
            answer: null,
            origins: [],
            gap: "Quantos anos com Kafka não está nos dados.",
          },
          { questionId: "q5", answer: "Sim", origins: [], gap: null },
          { questionId: "q6", answer: "Java; Kafka", origins: ["e1"], gap: null },
          { questionId: "q99", answer: "x", origins: [], gap: null },
        ],
      },
      resolve,
    );
    const by = (id: string) => r.find((a) => a.questionId === id);
    expect(by("q1")?.answer).toBe("Liderei a migração para Kafka na Acme.");
    expect(by("q1")?.origins).toEqual([
      { kind: "experience", id: "exp-1" },
      { kind: "achievement", id: "ach-2" },
    ]);
    expect(by("q2")).toMatchObject({ answer: "Imediato", gap: null });
    expect(by("q3")).toMatchObject({ answer: null, gap: expect.stringMatching(/fora das opções/) });
    expect(by("q4")).toMatchObject({
      answer: null,
      gap: "Quantos anos com Kafka não está nos dados.",
    });
    expect(by("q5")?.answer).toBe("Sim");
    expect(by("q6")?.answer).toBe("Java; Kafka");
    // o modelo esqueceu uma pergunta: vira lacuna, não some
    expect(by("q7")).toMatchObject({ answer: null, gap: expect.any(String), source: "model" });
    expect(by("q99")).toBeUndefined();
  });
});
