import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractPdfText } from "../../src/pdf";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));

describe("pdf/text (leitura 1: camada de texto via unpdf)", () => {
  it("extrai texto por página, conta páginas e detecta idioma de um CV com camada de texto", async () => {
    const r = await extractPdfText(fixture("cv_text.pdf"));
    expect(r.pageCount).toBe(2);
    expect(r.pages).toHaveLength(2);
    expect(r.pages[0]).toContain("Acme Ltda");
    expect(r.pages[1]).toContain("Unicamp");
    expect(r.text).toContain("EXPERIÊNCIA");
    expect(r.quality).toBeGreaterThan(0.5);
    expect(r.language).toBe("pt");
  });

  it("PDF escaneado (só imagem) tem quality baixa e texto vazio", async () => {
    const r = await extractPdfText(fixture("cv_scan.pdf"));
    expect(r.pageCount).toBe(3);
    expect(r.text.trim()).toBe("");
    expect(r.quality).toBeLessThan(0.1);
  });

  it("marca aviso acima de 20 páginas", async () => {
    const r = await extractPdfText(fixture("cv_text.pdf"));
    expect(r.tooManyPages).toBe(false);
  });
});
