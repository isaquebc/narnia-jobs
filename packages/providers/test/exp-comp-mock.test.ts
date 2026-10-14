import { describe, expect, it } from "vitest";
import { MockProvider, mockCompensation, PROMPTS } from "../src/index";

/** Campos novos da experiência: prompt de extração com as regras e o mock reconhecendo salário no texto. */
describe("extração de salário, carga e contrato", () => {
  it("o prompt traz as regras de contrato, carga, salário (sem converter) e a lista de benefícios", () => {
    const p = PROMPTS.extractFacts();
    for (const term of [
      "employmentType",
      "weeklyHours",
      "compensation",
      "Nunca converta",
      "benefitsOther",
      "birthday_day_off",
      "ISO-4217",
    ])
      expect(p).toContain(term);
  });

  it("mock: salário por hora, carga semanal e PJ do texto vão para a experiência, com citação literal", async () => {
    const text =
      "Trabalho na Acme Pagamentos desde 2021 como engenheira. Sou contratada como PJ, 30 horas semanais, e recebo R$ 95 por hora. Antes fiquei na Globex.";
    expect(mockCompensation(text)).toEqual({
      fields: {
        compensation: { amount: 95, period: "hourly", currency: "BRL" },
        weeklyHours: 30,
        employmentType: "pj",
      },
      quote: "Sou contratada como PJ, 30 horas semanais, e recebo R$ 95 por hora.",
    });
    const r = await new MockProvider().extractFacts({ text, locale: "pt-BR", model: "haiku" });
    expect(r.output.experiences[0]).toMatchObject({
      compensation: { amount: 95, period: "hourly", currency: "BRL" },
      weeklyHours: 30,
      employmentType: "pj",
    });
    expect(mockCompensation("R$ 12.500,50 por mês na Acme")?.fields.compensation).toEqual({
      amount: 12500.5,
      period: "monthly",
      currency: "BRL",
    });
    expect(mockCompensation("sem salário no texto")).toBeNull();
  });
});

describe("mock do chat: aviso de ingestão pronta", () => {
  it("a nota do sistema do fim da ingestão nunca abre outra ingestão", async () => {
    const { mockChatScript } = await import("../src/mock/mock-provider");
    const note =
      "(nota do sistema: a ingestão r1 que você abriu nesta conversa terminou: com sucesso. 2 propostas esperando a revisão.)";
    expect(mockChatScript(note, { category: "career" })[0]).toBe("evidence_experience_list");
    expect(mockChatScript("texto: minha história", { category: "career" })[0]).toBe("ingest_text");
  });
});

describe("mock: título da conversa", () => {
  it("as primeiras palavras da mensagem, sem o marcador de anexo; mensagem vaga vira o título padrão", async () => {
    const m = new MockProvider();
    const a = await m.chatTitle({
      message: "[anexo: cv.pdf]\nquanto pedir numa proposta PJ da Acme?",
      model: "haiku",
    });
    expect(a.output.title).toBe("Quanto pedir numa proposta PJ");
    const b = await m.chatTitle({ message: "oi", model: "haiku" });
    expect(b.output.title).toBe("Conversa com o recrutador");
  });
});
