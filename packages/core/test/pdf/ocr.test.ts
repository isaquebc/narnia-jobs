import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTesseractRecognizer,
  ocrPages,
  type Recognizer,
  renderPdfPages,
} from "../../src/pdf";

const fixturePath = new URL("../fixtures/cv_scan.pdf", import.meta.url).pathname;

function fakeRecognizer(map: Record<string, { text: string; confidence: number }>): Recognizer {
  return {
    async recognize(imagePath) {
      const key = imagePath.split("/").pop() as string;
      return map[key] ?? { text: "", confidence: 0 };
    },
    async terminate() {},
  };
}

describe("pdf/ocr (leitura 2: Tesseract por+eng)", () => {
  it("junta páginas na ordem, calcula confiança média e ignora página em branco", async () => {
    const rec = fakeRecognizer({
      "page-1.png": {
        text: "ANA MARIA EXEMPLO\nEngenheira de Software em Campinas\nAcme Ltda — 2021 a 2023",
        confidence: 0.91,
      },
      "page-2.png": { text: "Unicamp — 2014 a 2018", confidence: 0.88 },
      "page-3.png": { text: "   \n", confidence: 0.2 },
    });
    const r = await ocrPages(["/x/page-1.png", "/x/page-2.png", "/x/page-3.png"], rec);
    expect(r.pages).toHaveLength(3);
    expect(r.pages[2]).toEqual({ page: 3, text: "", confidence: 0 });
    expect(r.text).toBe(
      "ANA MARIA EXEMPLO\nEngenheira de Software em Campinas\nAcme Ltda — 2021 a 2023\n\nUnicamp — 2014 a 2018",
    );
    expect(r.quality).toBeCloseTo((0.91 + 0.88) / 2, 2);
    expect(r.language).toBe("pt");
  });

  it("sem páginas devolve texto vazio e quality 0", async () => {
    const r = await ocrPages([], fakeRecognizer({}));
    expect(r.text).toBe("");
    expect(r.quality).toBe(0);
  });
});

describe.runIf(process.env.OCR_REAL === "1")("pdf/ocr real (OCR_REAL=1)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  it("lê o CV escaneado da fixture com Tesseract e encontra Acme e Unicamp", async () => {
    const out = mkdtempSync(join(tmpdir(), "narnia-ocr-"));
    dirs.push(out);
    const pages = await renderPdfPages(fixturePath, out, { dpi: 150 });
    const rec = await createTesseractRecognizer();
    try {
      const r = await ocrPages(pages, rec);
      expect(r.text).toMatch(/Acme/i);
      expect(r.text).toMatch(/Unicamp/i);
      expect(r.pages[2]?.text).toBe("");
      expect(r.quality).toBeGreaterThan(0.5);
    } finally {
      await rec.terminate();
    }
  }, 120_000);
});
