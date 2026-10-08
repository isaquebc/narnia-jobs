import { recordUsage, saveDigest, usageFromSdkResult } from "@narnia-jobs/core";
import { consolidatedText, type Processor, runLocale } from "../pipeline";

/** Etapa 6: registro de contexto do arquivo (Sonnet por padrão). Upsert idempotente; preserva edição do usuário. */
export const digest: Processor = async (env, ctx, deps) => {
  await ctx.progress(10);
  const model = env.run.models.digest;
  const text = consolidatedText(deps, env.run.id);
  const proposals = deps.repos.proposals.listByRun(env.run.id).map((p) => p.proposal);
  const result = await deps.provider.buildDigest({
    text,
    proposals,
    locale: runLocale(deps.repos, env.run.id),
    model,
  });
  saveDigest(deps.repos, deps.dataDir, {
    fileId: env.file.id,
    sha256: env.file.sha256,
    text,
    digest: result.output,
  });
  deps.repos.ingestionRuns.addUsage(env.run.id, "digest", {
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cacheRead: result.usage.cacheReadTokens,
    cacheWrite: result.usage.cacheWriteTokens,
  });
  recordUsage(
    deps.repos,
    deps.dataDir,
    usageFromSdkResult(result.sdk, { category: "ingest.digest", model, jobId: ctx.jobId }),
  );
  return { skipped: false, summary: { keyPoints: result.output.keyPoints.length } };
};
