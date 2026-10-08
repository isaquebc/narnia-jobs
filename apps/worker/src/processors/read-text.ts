import { readFileSync } from "node:fs";
import { extractText } from "@narnia-jobs/core";
import { type Processor, readingPath, writeReadingText } from "../pipeline";

/** Etapa 1: camada de texto (PDF via unpdf; DOCX/MD/texto livre direto). Sem tokens. */
export const readText: Processor = async (env, ctx, deps) => {
  const existing = deps.repos.readings.listByRun(env.run.id).find((r) => r.kind === "text_layer");
  if (existing) return { skipped: true, summary: { readingId: existing.id } };
  await ctx.progress(10);
  const t0 = Date.now();
  const buffer = readFileSync(env.filePath);
  const extracted = await extractText(buffer, {
    ...(env.file.originalName ? { originalName: env.file.originalName } : {}),
  });
  const rel = readingPath(env.run.id, "text_layer");
  writeReadingText(deps.dataDir, rel, extracted.text);
  const reading = deps.repos.readings.insert({
    runId: env.run.id,
    kind: "text_layer",
    textPath: rel,
    quality: extracted.quality,
    pages: {
      kind: extracted.kind,
      pageCount: extracted.pages ?? null,
      language: extracted.language,
      tooManyPages: extracted.tooManyPages ?? false,
    },
    durationMs: Date.now() - t0,
  });
  return {
    skipped: false,
    summary: { readingId: reading.id, chars: extracted.text.length, quality: extracted.quality },
  };
};
