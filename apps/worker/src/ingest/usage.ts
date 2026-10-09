import { recordUsage, usageFromSdkResult } from "@narnia-jobs/core";
import type { ProviderResult } from "@narnia-jobs/providers";
import type { WorkerDeps } from "../pipeline";

/** Uso real de uma chamada: soma no run (freio e relatório) e vira `usage_event` com categoria própria. */
export function recordCall(
  deps: WorkerDeps,
  o: { runId: string; name: string; category: string; jobId: string },
  result: ProviderResult<unknown>,
): number {
  deps.repos.ingestionRuns.addUsage(o.runId, o.name, {
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cacheRead: result.usage.cacheReadTokens,
    cacheWrite: result.usage.cacheWriteTokens,
  });
  recordUsage(
    deps.repos,
    deps.dataDir,
    usageFromSdkResult(result.sdk, {
      category: o.category,
      model: result.usage.model,
      jobId: o.jobId,
    }),
  );
  return result.usage.inputTokens + result.usage.outputTokens;
}
