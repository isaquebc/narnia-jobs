import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  detectFileType,
  detectLanguage,
  ExtractError,
  extractDocxText,
  extractMarkdownText,
  extractText,
  MAX_FREE_TEXT_CHARS,
  MAX_UPLOAD_BYTES,
  MIN_FREE_TEXT_CHARS,
  normalizeFreeText,
  validateFreeText,
} from "../../src/extract";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));

describe("extract/detect (magic bytes, não extensão)", () => {
  it("reconhece PDF, DOCX, Markdown e texto", () => {
    expect(detectFileType(fixture("cv_text.pdf"), "qualquer.bin")).toEqual({
      kind: "pdf",
      mime: "application/pdf",
    });
    expect(detectFileType(fixture("cv.docx"), "cv.docx").kind).toBe("docx");
    expect(detectFileType(fixture("cv.md"), "cv.md").kind).toBe("markdown");
    expect(detectFileType(fixture("texto_livre.txt"), "x.txt").kind).toBe("text");
  });
  it("rejeita executável renomeado para .pdf e arquivo binário desconhecido", async () => {
    const fakeExe = Buffer.concat([Buffer.from("MZ\x90\x00"), Buffer.alloc(64, 0)]);
    expect(detectFileType(fakeExe, "cv.pdf").kind).toBe("unknown");
    await expect(extractText(fakeExe, { originalName: "cv.pdf" })).rejects.toThrow(ExtractError);
  });
  it("limite de 10 MB", async () => {
    const big = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x20);
    await expect(extractText(big, { originalName: "x.txt" })).rejects.toMatchObject({
      code: "too_large",
    });
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("extract/docx e markdown", () => {
  it("DOCX via mammoth preserva parágrafos e títulos como texto", async () => {
    const r = await extractDocxText(fixture("cv.docx"));
    expect(r.text).toContain("Ana Maria Exemplo");
    expect(r.text).toContain("Acme Ltda");
    expect(r.text).toContain("Unicamp");
  });
  it("Markdown remove marcação e mantém o conteúdo", () => {
    const r = extractMarkdownText(fixture("cv.md").toString("utf8"));
    expect(r.text).toContain("Ana Maria Exemplo");
    expect(r.text).not.toContain("**");
    expect(r.text).not.toMatch(/^#/m);
    expect(r.text).toContain("Reduziu a latência p95");
  });
});

describe("extract/free-text", () => {
  it("normaliza quebras e espaços e respeita mínimo de 200 e máximo de 50k", () => {
    const raw = "Linha 1\r\n\r\n\r\n\r\nLinha 2   \t com espaços\r\n";
    expect(normalizeFreeText(raw)).toBe("Linha 1\n\nLinha 2 com espaços");
    expect(MIN_FREE_TEXT_CHARS).toBe(200);
    expect(MAX_FREE_TEXT_CHARS).toBe(50_000);
    expect(() => validateFreeText("curto")).toThrow(ExtractError);
    try {
      validateFreeText("curto");
    } catch (e) {
      expect((e as ExtractError).code).toBe("too_short");
    }
    expect(() => validateFreeText("a".repeat(50_001))).toThrowError(/longo/);
    expect(validateFreeText(fixture("texto_livre.txt").toString("utf8"))).toBeTypeOf("string");
  });
});

describe("extract/language", () => {
  it("detecta pt e en por stopwords; indefinido para texto sem pistas", () => {
    expect(
      detectLanguage(
        "Trabalhei como engenheira de software e liderei a migração dos serviços para a nuvem.",
      ),
    ).toBe("pt");
    expect(
      detectLanguage(
        "I worked as a software engineer and led the migration of the services to the cloud.",
      ),
    ).toBe("en");
    expect(detectLanguage("Go Kubernetes PostgreSQL 2021")).toBe("unknown");
  });
});

describe("extract/extractText (despachante)", () => {
  it("PDF devolve páginas e quality; DOCX, MD e texto devolvem texto com idioma", async () => {
    const pdf = await extractText(fixture("cv_text.pdf"), { originalName: "cv.pdf" });
    expect(pdf.kind).toBe("pdf");
    expect(pdf.pages).toBe(2);
    expect(pdf.language).toBe("pt");
    const docx = await extractText(fixture("cv.docx"), { originalName: "cv.docx" });
    expect(docx.kind).toBe("docx");
    expect(docx.text).toContain("Acme");
    const md = await extractText(fixture("cv.md"), { originalName: "cv.md" });
    expect(md.kind).toBe("markdown");
    const txt = await extractText(fixture("texto_livre.txt"), { originalName: "historia.txt" });
    expect(txt.kind).toBe("text");
    expect(txt.text.length).toBeGreaterThan(MIN_FREE_TEXT_CHARS);
    expect(txt.quality).toBe(1);
  });
});
