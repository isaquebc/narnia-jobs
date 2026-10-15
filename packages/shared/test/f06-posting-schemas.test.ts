import { describe, expect, it } from "vitest";
import {
  POSTING_OUTPUT_JSON_SCHEMAS,
  PostingCreateSchema,
  PostingDuplicateOutputSchema,
  PostingFieldsSchema,
  PostingMergeOutputSchema,
  PreAnalysisSchema,
} from "../src/index";

/** F06/M2-M4 · schemas da vaga, da pré-análise e das saídas dos modelos. */
describe("F06 shared · schemas da vaga", () => {
  it("criação exige algum dado; papel, senioridade e URL validados", () => {
    expect(PostingCreateSchema.safeParse({}).success).toBe(false);
    expect(PostingCreateSchema.safeParse({ jdText: "Vaga backend" }).success).toBe(true);
    expect(PostingCreateSchema.safeParse({ company: "X", role: "chef" }).success).toBe(false);
    expect(PostingCreateSchema.safeParse({ company: "X", postingUrl: "não é url" }).success).toBe(
      false,
    );
  });

  it("campos: listas com padrão vazio; data de publicação parcial", () => {
    const f = PostingFieldsSchema.partial().parse({ publishedAt: "2026-10" });
    expect(f.publishedAt).toBe("2026-10");
  });

  it("duplicata: certeza de 0 a 100 inteira", () => {
    expect(
      PostingDuplicateOutputSchema.safeParse({
        sameJob: true,
        confidence: 101,
        differences: [],
        rationale: "x",
      }).success,
    ).toBe(false);
  });

  it("merge: origem só heuristic/model/both e só campos conhecidos", () => {
    expect(
      PostingMergeOutputSchema.shape.fieldSources.safeParse([{ field: "company", source: "user" }])
        .success,
    ).toBe(false);
    expect(
      PostingMergeOutputSchema.shape.fieldSources.safeParse([{ field: "salario", source: "model" }])
        .success,
    ).toBe(false);
  });

  it("pré-análise: versão 1 e cobertura entre 0 e 1", () => {
    expect(
      PreAnalysisSchema.safeParse({
        version: 1,
        keywords: [],
        ngrams: [],
        sectionsDetected: false,
        yearsMin: null,
        coverage: 1.5,
        risksByProfile: {},
        createdAt: "2026-10-14T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("JSON Schemas das saídas sem $schema (saída estruturada)", () => {
    for (const s of Object.values(POSTING_OUTPUT_JSON_SCHEMAS)) {
      expect(s).not.toHaveProperty("$schema");
      expect(s.type).toBe("object");
    }
  });
});
