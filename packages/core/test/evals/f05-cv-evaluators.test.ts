import { describe, expect, it } from "vitest";
import { cvFactIds, cvNoGapTerms } from "../../src/evals/prompt-evaluators";

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
