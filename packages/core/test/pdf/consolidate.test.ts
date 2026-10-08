import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { consolidateReadings, type ReadingInputText } from "../../src/pdf";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/readings/divergences.json", import.meta.url), "utf8"),
) as { readings: ReadingInputText[] };

describe("pdf/consolidate (decisão F01-22: por seção, voto 2 de 3, origem por trecho)", () => {
  it("resolve divergências plantadas por maioria e registra origem e concordância por segmento", () => {
    const r = consolidateReadings(fixture.readings);
    expect(r.text).toContain("Acme Ltda");
    expect(r.text).not.toContain("Acrne");
    expect(r.text).toContain("mar/2021");
    expect(r.text).not.toContain("2027");
    expect(r.segments.length).toBeGreaterThanOrEqual(4);
    const exp = r.segments.find((s) => s.text.includes("Acme Ltda"));
    expect(exp).toBeDefined();
    expect(exp?.divergences.length).toBeGreaterThanOrEqual(1);
    expect(
      exp?.divergences.some(
        (d) => d.chosen.includes("2021") && d.values.text_layer?.includes("2027"),
      ),
    ).toBe(true);
    expect(
      exp?.divergences.some((d) => d.chosen.includes("Acme") && d.values.ocr?.includes("Acrne")),
    ).toBe(true);
    expect(exp?.agreement).toBeLessThan(1);
    const edu = r.segments.find((s) => s.text.includes("Unicamp"));
    expect(edu?.agreement).toBe(1);
    expect(edu?.divergences).toEqual([]);
    expect(["text_layer", "ocr", "model_read"]).toContain(exp?.origin);
    expect(r.segments.map((s) => s.index)).toEqual(r.segments.map((_, i) => i));
    expect(r.usedKinds.sort()).toEqual(["model_read", "ocr", "text_layer"]);
  });

  it("tolera leitura ausente (OCR desligado) e PDF só-imagem (camada de texto vazia é descartada)", () => {
    const [text, _ocr, model] = fixture.readings as [
      ReadingInputText,
      ReadingInputText,
      ReadingInputText,
    ];
    const two = consolidateReadings([text, model]);
    expect(two.text).toContain("Acme Ltda");
    expect(two.usedKinds.sort()).toEqual(["model_read", "text_layer"]);
    const imageOnly = consolidateReadings([
      { kind: "text_layer", quality: 0.02, text: "" },
      fixture.readings[1] as ReadingInputText,
      model,
    ]);
    expect(imageOnly.usedKinds.sort()).toEqual(["model_read", "ocr"]);
    expect(imageOnly.text).toContain("Acme Ltda");
    expect(imageOnly.segments.every((s) => s.origin !== "text_layer")).toBe(true);
  });

  it("uma única leitura vira segmentos com agreement 1 e sem divergências; nenhuma leitura é erro", () => {
    const one = consolidateReadings([fixture.readings[2] as ReadingInputText]);
    expect(one.segments.every((s) => s.agreement === 1 && s.divergences.length === 0)).toBe(true);
    expect(one.text).toBe((fixture.readings[2] as ReadingInputText).text);
    expect(() => consolidateReadings([])).toThrow();
  });
});
