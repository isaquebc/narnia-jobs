import { recordUsage, usageFromSdkResult } from "@narnia-jobs/core";
import { extractFactsOutputToProposals } from "@narnia-jobs/shared";
import { consolidatedText, type Processor, runLocale } from "../pipeline";

/** Etapa 5: fatos candidatos (Haiku por padrão). Idempotente: run com propostas não chama o modelo de novo. */
export const facts: Processor = async (env, ctx, deps) => {
  const existing = deps.repos.proposals.listByRun(env.run.id);
  if (existing.length > 0) return { skipped: true, summary: { proposals: existing.length } };
  await ctx.progress(10);
  const model = env.run.models.facts;
  const result = await deps.provider.extractFacts({
    text: consolidatedText(deps, env.run.id),
    locale: runLocale(deps.repos, env.run.id),
    model,
  });
  const proposals = extractFactsOutputToProposals(result.output);
  deps.repos.proposals.insertMany(env.run.id, proposals);
  deps.repos.ingestionRuns.addUsage(env.run.id, "facts", {
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cacheRead: result.usage.cacheReadTokens,
    cacheWrite: result.usage.cacheWriteTokens,
  });
  recordUsage(
    deps.repos,
    deps.dataDir,
    usageFromSdkResult(result.sdk, { category: "ingest.facts", model, jobId: ctx.jobId }),
  );
  return { skipped: false, summary: { proposals: proposals.length } };
};
