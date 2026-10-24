import type { ApplicationQuestion } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import {
  answerableQuestions,
  assembleAnswers,
  assembleRoleplay,
  detectFormLocale,
  splitOpenQuestions,
} from "../../src/applications/answer";
import { createRepos, migrate, openDatabase } from "../../src/db";

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

/**
 * F12-18 · roleplay (pedido do dono, 2026-10-24): as perguntas abertas ("por que esta empresa", "conte sobre você") vão
 * a um agente que escreve como a pessoa, em primeira pessoa, e diz o que supôs para ela conferir; as de fato (anos,
 * escolhas, cidade) continuam no redator. F12-19: a pessoa edita a resposta antes de preencher; a edição vira versão.
 */
describe("F12-18 · perguntas abertas no roleplay", () => {
  it("texto longo e pergunta curta de motivação vão ao roleplay; o resto fica no redator", () => {
    const qs = [
      q("q1", { kind: "long_text", question: "Conte um desafio técnico" }),
      q("q2", { question: "Briefly describe why you are interested in Vitalis." }),
      q("q3", { question: "Cargo atual" }),
      q("q4", { kind: "number", question: "Anos de experiência" }),
      q("q5", { question: "Tell us about yourself" }),
      q("q6", {
        kind: "choice",
        question: "Why this role?",
        options: [{ value: "1", label: "A" }],
      }),
    ];
    const { facts, open } = splitOpenQuestions(qs);
    expect(open.map((x) => x.id)).toEqual(["q1", "q2", "q5"]);
    expect(facts.map((x) => x.id)).toEqual(["q3", "q4", "q6"]);
  });

  it("monta a resposta simulada: suposições, limite, origens conferidas, esquecida vira lacuna", () => {
    const qs = [
      q("q1", { kind: "long_text", maxChars: 50 }),
      q("q2", { kind: "long_text" }),
      q("q3", { kind: "long_text" }),
    ];
    const r = assembleRoleplay(
      qs,
      {
        answers: [
          {
            questionId: "q1",
            answer:
              "Quero trabalhar com saúde. Na Acme liderei a migração para Kafka e gostei muito.",
            assumptions: [" Que você quer trabalhar com saúde. ", ""],
            origins: ["e1", "zz"],
            gap: null,
          },
          { questionId: "q2", answer: "  ", assumptions: [], origins: [], gap: null },
        ],
      },
      resolve,
    );
    const by = (id: string) => r.find((a) => a.questionId === id);
    expect(by("q1")).toMatchObject({
      answer: "Quero trabalhar com saúde.",
      assumptions: ["Que você quer trabalhar com saúde."],
      origins: [{ kind: "experience", id: "exp-1" }],
      source: "roleplay",
      gap: null,
    });
    expect(by("q2")).toMatchObject({ answer: null, gap: expect.any(String), assumptions: [] });
    expect(by("q3")).toMatchObject({ answer: null, gap: expect.any(String), source: "roleplay" });
  });
});

describe("F12-18/F12-19 · respostas no banco", () => {
  it("0022 entra sobre o banco anterior; guarda suposições, edição e as amostras da escrita da pessoa", () => {
    const db = openDatabase(":memory:");
    migrate(db, { until: "0021_application_answer" });
    db.prepare(
      `insert into application_answer (id, form_id, question_id, version, answer, origins_json, gap, source, created_at)
       values ('old', 'f0', 'q1', 1, 'resposta antiga', '[]', null, 'model', '2026-10-23T00:00:00.000Z')`,
    ).run();
    expect(migrate(db).applied).toEqual(expect.arrayContaining(["0022_application_roleplay"]));
    const repos = createRepos(db);
    expect(repos.applications.latestAnswers("f0")).toEqual([
      expect.objectContaining({ answer: "resposta antiga", assumptions: [], source: "model" }),
    ]);
    repos.applications.addAnswers("f1", [
      {
        questionId: "q1",
        answer: "Rascunho simulado.",
        origins: [],
        gap: null,
        assumptions: ["Que você gosta de saúde."],
        source: "roleplay",
      },
    ]);
    const long = "Escrevo assim, direto, sem enfeite, contando o que fiz e o que aprendi com isso.";
    repos.applications.addAnswers("f1", [
      { questionId: "q1", answer: long, origins: [], gap: null, assumptions: [], source: "edited" },
      {
        questionId: "q2",
        answer: "Sim",
        origins: [],
        gap: null,
        assumptions: [],
        source: "edited",
      },
    ]);
    expect(repos.applications.latestAnswers("f1")[0]).toMatchObject({
      version: 2,
      answer: long,
      source: "edited",
    });
    // amostras: só textos editados pela pessoa, longos, de outros formulários
    expect(repos.applications.editedTexts({ excludeFormId: "f2", limit: 3 })).toEqual([long]);
    expect(repos.applications.editedTexts({ excludeFormId: "f1", limit: 3 })).toEqual([]);
  });
});
