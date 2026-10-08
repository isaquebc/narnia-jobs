import { describe, expect, it } from "vitest";
import { estimateExtraction, PROMPT_OVERHEAD, TOKENS_PER_PDF_PAGE } from "../src/estimate";

const models = { document: "haiku", facts: "haiku", digest: "sonnet" };

describe("estimate (estimativa por chamada antes de confirmar, F01 §2.5)", () => {
  it("texto vazio: só overhead dos prompts; sem PDF não há chamada de leitura do documento", () => {
    const e = estimateExtraction({ textChars: 0, models, options: { ocr: true, modelRead: true } });
    expect(e.calls.document).toBeUndefined();
    expect(e.calls.facts).toEqual({ model: "haiku", tokens: PROMPT_OVERHEAD.facts });
    expect(e.calls.digest).toEqual({ model: "sonnet", tokens: PROMPT_OVERHEAD.digest });
    expect(e.totalTokens).toBe(PROMPT_OVERHEAD.facts + PROMPT_OVERHEAD.digest);
  });
  it("50k chars ≈ 12,5k tokens de entrada por chamada + overhead; PDF com leitura pelo modelo soma páginas", () => {
    const e = estimateExtraction({
      textChars: 50_000,
      pdfPages: 2,
      models,
      options: { ocr: true, modelRead: true },
    });
    expect(e.calls.document).toEqual({
      model: "haiku",
      tokens: 2 * TOKENS_PER_PDF_PAGE + PROMPT_OVERHEAD.document,
    });
    expect(e.calls.facts?.tokens).toBe(12_500 + PROMPT_OVERHEAD.facts);
    expect(e.calls.digest?.tokens).toBe(
      12_500 + PROMPT_OVERHEAD.digest + PROMPT_OVERHEAD.factsAsInput,
    );
    expect(e.totalTokens).toBe(
      (e.calls.document?.tokens ?? 0) +
        (e.calls.facts?.tokens ?? 0) +
        (e.calls.digest?.tokens ?? 0),
    );
    expect(e.labels.join(" + ")).toMatch(/haiku/);
    expect(e.labels.join(" + ")).toMatch(/sonnet/);
  });
  it("leitura pelo modelo desligada remove a chamada de documento mesmo em PDF", () => {
    const e = estimateExtraction({
      textChars: 1000,
      pdfPages: 3,
      models,
      options: { ocr: false, modelRead: false },
    });
    expect(e.calls.document).toBeUndefined();
  });
});
