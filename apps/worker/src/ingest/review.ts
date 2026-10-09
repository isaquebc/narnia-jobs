import {
  applyCheckResults,
  applyReconciliation,
  buildCheckBatch,
  CHEAPEST_MODEL,
  loadRunSources,
  resolveIngestSettings,
  runCheckLayer1,
} from "@narnia-jobs/core";
import type { WorkerDeps } from "../pipeline";
import { recordCall } from "./usage";

/** Reconciliação com os fatos existentes (F03 §2.8): novo, existente ou conflito; tags por perfil. 0 tokens. */
export function reconcileRun(deps: WorkerDeps, runId: string) {
  return applyReconciliation(deps.repos, runId);
}

/**
 * Revisão anti-alucinação (F03-3 §8): camada 1 sem tokens (o trecho citado existe no material enviado?) e camada 2
 * em lote no modelo mais barato, desligável em Configurações. Nada é apagado; o selo vai para a revisão.
 */
export async function reviewCheckRun(
  deps: WorkerDeps,
  runId: string,
  jobId: string,
): Promise<{ unchecked: number; unsupported: number; checked: number }> {
  const layer1 = runCheckLayer1(deps.repos, runId, loadRunSources(deps.dataDir, runId));
  let checked = 0;
  if (resolveIngestSettings(deps.repos.settings).reviewCheckModelEnabled) {
    const items = buildCheckBatch(deps.repos.proposals.listByRun(runId));
    if (items.length > 0) {
      const result = await deps.provider.checkProposals({ items, model: CHEAPEST_MODEL });
      recordCall(deps, { runId, name: "check", category: "ingest.review_check", jobId }, result);
      checked = applyCheckResults(deps.repos, result.output.results);
    }
  }
  return { ...layer1, checked };
}
