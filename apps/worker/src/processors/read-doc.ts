import { recordUsage, usageFromSdkResult } from "@narnia-jobs/core";
import { type Processor, readingPath, runLocale, writeReadingText } from "../pipeline";

/** Qualidade atribuída à leitura do documento pelo modelo: perde para uma camada de texto completa, ganha de PDF escaneado. */
export const MODEL_READ_QUALITY = 0.92;

/** Etapa 3 (só PDF): o modelo lê o arquivo com a tool Read. Gasta tokens; idempotente. */
export const readDoc: Processor = async (env, ctx, deps) => {
  const existing = deps.repos.readings.listByRun(env.run.id).find((r) => r.kind === "model_read");
  if (existing) return { skipped: true, summary: { readingId: existing.id } };
  if (!env.isPdf) return { skipped: true, summary: { reason: "não é PDF" } };
  await ctx.progress(10);
  const t0 = Date.now();
  const model = env.run.models.document;
  const result = await deps.provider.readDocument({
    filePath: env.filePath,
    locale: runLocale(deps.repos, env.run.id),
    model,
  });
  const rel = readingPath(env.run.id, "model_read");
  writeReadingText(deps.dataDir, rel, result.output.text);
  const reading = deps.repos.readings.insert({
    runId: env.run.id,
    kind: "model_read",
    textPath: rel,
    quality: MODEL_READ_QUALITY,
    pages: { sections: result.output.sections },
    usage: result.sdk,
    durationMs: Date.now() - t0,
  });
  deps.repos.ingestionRuns.addUsage(env.run.id, "document", {
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cacheRead: result.usage.cacheReadTokens,
    cacheWrite: result.usage.cacheWriteTokens,
  });
  recordUsage(
    deps.repos,
    deps.dataDir,
    usageFromSdkResult(result.sdk, { category: "ingest.read_doc", model, jobId: ctx.jobId }),
  );
  return { skipped: false, summary: { readingId: reading.id, chars: result.output.text.length } };
};
