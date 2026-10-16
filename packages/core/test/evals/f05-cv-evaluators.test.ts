import { describe, expect, it } from "vitest";
import {
  cvFactIds,
  cvNoGapTerms,
  cvSourceTitles,
  letterWordCount,
} from "../../src/evals/prompt-evaluators";

/** F05/M2 · avaliadores de honestidade do CV e da carta no Phoenix. */
const brief = JSON.stringify({
  experiences: [{ id: "e1", achievements: [{ id: "a1" }] }],
  skills: [{ id: "s1", name: "Docker" }],
  gaps: ["Kubernetes", "Kafka"],
});

describe("F05/M2 · avaliadores do CV", () => {
  it("origens: só ids do resumo", () => {
    const ok = {
      experiences: [
        { factId: "e1", bullets: [{ text: "x", factIds: [{ kind: "achievement", id: "a1" }] }] },
      ],
    };
    expect(cvFactIds({ output: ok, input: { brief_json: brief } }).label).toBe("passou");
    const bad = {
      experiences: [
        { factId: "e9", bullets: [{ text: "x", factIds: [{ kind: "achievement", id: "a7" }] }] },
      ],
    };
    const r = cvFactIds({ output: bad, input: { brief_json: brief } });
    expect(r.label).toBe("falhou");
    expect(r.explanation).toMatch(/e9.*a7|a7.*e9/);
  });

  it("lacunas: nenhum termo no CV; na carta, só no parágrafo das lacunas", () => {
    expect(
      cvNoGapTerms({ output: { summary: "Docker em produção." }, input: { brief_json: brief } })
        .label,
    ).toBe("passou");
    expect(
      cvNoGapTerms({ output: { summary: "Kubernetes em produção." }, input: { brief_json: brief } })
        .label,
    ).toBe("falhou");
    // o termo pedido fica registrado em adjacent.asked; o texto mostra a experiência próxima
    const adj = {
      summary: "Docker em produção.",
      adjacent: [{ asked: "Kubernetes", shown: "Docker", factIds: [] }],
    };
    expect(cvNoGapTerms({ output: adj, input: { brief_json: brief } }).label).toBe("passou");
    const letter = (role: string) => ({
      paragraphs: [{ role, text: "Ainda não usei Kafka, mas aprendo rápido." }],
    });
    expect(cvNoGapTerms({ output: letter("gaps"), input: { brief_json: brief } }).label).toBe(
      "passou",
    );
    expect(cvNoGapTerms({ output: letter("covers"), input: { brief_json: brief } }).label).toBe(
      "falhou",
    );
  });
});

describe("F05/M2 · idioma do CV pelo resumo", async () => {
  const { language } = await import("../../src/evals/prompt-evaluators");
  it("en-US no resumo confere inglês; pt-BR confere português", () => {
    const en = JSON.stringify({ locale: "en-US" });
    const pt = JSON.stringify({ locale: "pt-BR" });
    const out = (summary: string) => ({ summary });
    expect(
      language(
        {
          output: out("Backend engineer with a focus on the payments platform and the team."),
          input: { brief_json: en },
        },
        { fields: ["summary"] },
      ).label,
    ).toBe("passou");
    expect(
      language(
        {
          output: out("Engenheira backend com foco na plataforma de pagamentos e no time."),
          input: { brief_json: en },
        },
        { fields: ["summary"] },
      ).label,
    ).toBe("falhou");
    expect(
      language(
        {
          output: out("Engenheira backend com foco na plataforma de pagamentos e no time."),
          input: { brief_json: pt },
        },
        { fields: ["summary"] },
      ).label,
    ).toBe("passou");
  });
});

describe("F05 · cargos e formação como nos dados quando o idioma é o mesmo", () => {
  const ptBrief = (locale: string) =>
    JSON.stringify({
      locale,
      sourceLocale: "pt-BR",
      experiences: [
        { id: "e1", title: "Engenheira de Software Sênior" },
        { id: "e2", title: "Desenvolvedora Backend" },
      ],
      education: [{ id: "ed1", course: "Ciência da Computação", degree: "Bacharelado" }],
    });
  const out = (
    t1: string,
    t2: string,
    course = "Ciência da Computação",
    degree = "Bacharelado",
  ) => ({
    experiences: [
      { factId: "e1", title: t1 },
      { factId: "e2", title: t2 },
    ],
    education: [{ factId: "ed1", course, degree }],
  });

  it("pt-BR com dados em pt-BR: cada cargo e curso igual ao dado; nota pela fração", () => {
    const ok = cvSourceTitles({
      output: out("Engenheira de Software Sênior", "Desenvolvedora Backend"),
      input: { brief_json: ptBrief("pt-BR") },
    });
    expect(ok).toMatchObject({ label: "passou", score: 1 });
    const bad = cvSourceTitles({
      output: out("Senior Software Engineer", "Desenvolvedora Backend", "Computer Science"),
      input: { brief_json: ptBrief("pt-BR") },
    });
    expect(bad.label).toBe("falhou");
    expect(bad.score).toBe(0.5);
    expect(bad.explanation).toMatch(/Senior Software Engineer/);
    expect(bad.explanation).toMatch(/Computer Science/);
  });

  it("idioma diferente: cargo e curso copiados em português num CV em inglês contam como erro", () => {
    expect(
      cvSourceTitles({
        output: out(
          "Senior Software Engineer",
          "Backend Developer",
          "Computer Science",
          "Bachelor's degree",
        ),
        input: { brief_json: ptBrief("en-US") },
      }),
    ).toMatchObject({ label: "passou", score: 1 });
    const bad = cvSourceTitles({
      output: out(
        "Engenheira de Software Sênior",
        "Backend Developer",
        "Computer Science",
        "Bachelor's degree",
      ),
      input: { brief_json: ptBrief("en-US") },
    });
    expect(bad.label).toBe("falhou");
    expect(bad.explanation).toMatch(/Engenheira de Software Sênior/);
    // nome que não muda entre idiomas (Tech Lead) não conta
    expect(
      cvSourceTitles({
        output: { experiences: [{ factId: "e1", title: "Tech Lead" }] },
        input: {
          brief_json: JSON.stringify({
            locale: "en-US",
            sourceLocale: "pt-BR",
            experiences: [{ id: "e1", title: "Tech Lead" }],
          }),
        },
      }).label,
    ).toBe("passou");
  });

  it("idioma dos dados desconhecido: não se aplica", () => {
    expect(
      cvSourceTitles({
        output: out("x", "y"),
        input: { brief_json: JSON.stringify({ locale: "pt-BR", sourceLocale: null }) },
      }).label,
    ).toBe("passou");
  });
});

describe("F05 · tamanho da carta", () => {
  const letter = (...sizes: number[]) => ({
    paragraphs: sizes.map((n, i) => ({
      role: ["why", "covers", "gaps", "closing"][i],
      text: "palavra ".repeat(n).trim(),
    })),
  });

  it("de 250 a 400 palavras somando os parágrafos passa; fora disso falha com a contagem", () => {
    expect(letterWordCount({ output: letter(80, 120, 70, 40) })).toMatchObject({
      label: "passou",
      score: 1,
    });
    const short = letterWordCount({ output: letter(58, 85, 65, 27) });
    expect(short).toMatchObject({ label: "falhou", score: 0 });
    expect(short.explanation).toMatch(/235/);
    expect(letterWordCount({ output: letter(150, 150, 100, 50) }).label).toBe("falhou");
  });
});
