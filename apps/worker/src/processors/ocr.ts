import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_PDF_PAGES, ocrPages } from "@narnia-jobs/core";
import { type Processor, readingPath, writeReadingText } from "../pipeline";

/** Etapa 2 (só PDF): renderiza páginas e roda OCR (Tesseract). Sem tokens. Limite de 20 páginas em F01. */
export const ocrPagesStage: Processor = async (env, ctx, deps) => {
  const existing = deps.repos.readings.listByRun(env.run.id).find((r) => r.kind === "ocr");
  if (existing) return { skipped: true, summary: { readingId: existing.id } };
  if (!env.isPdf) return { skipped: true, summary: { reason: "não é PDF" } };
  const t0 = Date.now();
  const tmp = mkdtempSync(join(tmpdir(), "narnia-ocr-"));
  try {
    await ctx.progress(10);
    const pages = (await deps.ocr.render(env.filePath, tmp)).slice(0, MAX_PDF_PAGES);
    await ctx.progress(40);
    const recognizer = await deps.ocr.createRecognizer();
    try {
      const result = await ocrPages(pages, recognizer);
      const rel = readingPath(env.run.id, "ocr");
      writeReadingText(deps.dataDir, rel, result.text);
      const reading = deps.repos.readings.insert({
        runId: env.run.id,
        kind: "ocr",
        textPath: rel,
        quality: result.quality,
        pages: {
          language: result.language,
          pages: result.pages.map((p) => ({ page: p.page, confidence: p.confidence })),
        },
        durationMs: Date.now() - t0,
      });
      return {
        skipped: false,
        summary: { readingId: reading.id, pages: pages.length, quality: result.quality },
      };
    } finally {
      await recognizer.terminate();
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
};
