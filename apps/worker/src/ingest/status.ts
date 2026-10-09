import { type RunStatus, syncRunNotifications } from "@narnia-jobs/core";
import type { WorkerDeps } from "../pipeline";

/**
 * Estado da execução + notificações (F03 §2.8): toda mudança publica `ingestion.updated` e sincroniza as
 * pendências do run (criadas, atualizadas ou resolvidas), retransmitidas por WS.
 */
export async function notifyRun(deps: WorkerDeps, runId: string): Promise<void> {
  const run = deps.repos.ingestionRuns.get(runId);
  if (!run) return;
  await deps.publish({ type: "ingestion.updated", runId, status: run.status });
  for (const ev of syncRunNotifications(deps.repos, runId)) {
    await deps.publish({
      type: ev.created ? "notification.created" : "notification.updated",
      notification: ev.notification,
    });
  }
}

export async function setRunStatus(
  deps: WorkerDeps,
  runId: string,
  status: RunStatus,
  patch?: { error?: string | null },
): Promise<void> {
  deps.repos.ingestionRuns.setStatus(runId, status, patch);
  await notifyRun(deps, runId);
}
