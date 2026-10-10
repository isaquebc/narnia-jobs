import {
  type IngestionRunRecord,
  type Repos,
  resolveAnalysisDone,
  syncRunNotifications,
  syncSuggestionNotifications,
  type TaskRequest,
} from "@narnia-jobs/core";
import type { EventBus } from "../events";
import type { QueueAdapter } from "../queue";

/** Estado da execução e notificações por WS (F03 §2.8), espelhando o que o worker publica. */
export function emitRun(bus: EventBus, repos: Repos, runId: string): void {
  const run = repos.ingestionRuns.get(runId);
  if (!run) return;
  bus.emit({ type: "ingestion.updated", runId, status: run.status });
  for (const ev of syncRunNotifications(repos, runId)) {
    bus.emit({
      type: ev.created ? "notification.created" : "notification.updated",
      notification: ev.notification,
    });
  }
}

export async function enqueueAll(queue: QueueAdapter, tasks: TaskRequest[]): Promise<void> {
  for (const t of tasks) await queue.enqueueTask(t);
}

/** Resumo da execução para listas (bandeja, pendências); nunca inclui credenciais. */
export function runSummary(run: IngestionRunRecord) {
  return {
    id: run.id,
    source: run.source,
    mode: run.mode,
    status: run.status,
    fileId: run.fileId,
    model: run.model,
    budget: run.budget,
    report: run.report,
    createdAt: run.createdAt,
  };
}

/**
 * Notificações das sugestões de perfil (F03-10): sincroniza as de sugestões novas/decididas e, quando o usuário viu
 * a página de perfis ou decidiu uma sugestão, resolve as de "análise concluída"; tudo retransmitido por WS.
 */
export function emitSuggestionNotifications(
  bus: EventBus,
  repos: Repos,
  opts: { resolveAnalysis?: boolean } = {},
): void {
  for (const ev of syncSuggestionNotifications(repos)) {
    bus.emit({
      type: ev.created ? "notification.created" : "notification.updated",
      notification: ev.notification,
    });
  }
  if (opts.resolveAnalysis) {
    for (const n of resolveAnalysisDone(repos))
      bus.emit({ type: "notification.updated", notification: n });
  }
}
