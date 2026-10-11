import {
  healStuckRun,
  isJobStale,
  type QueueStateFn,
  RUN_SUBJECT,
  runJobs,
  type StageJobData,
  syncRunJobs,
  type TaskJobData,
  taskOfJob,
} from "@narnia-jobs/core";
import { nowUtc } from "@narnia-jobs/shared";
import { handleQueueEvent } from "./events";
import { notifyRun } from "./ingest/status";
import { onStageFailed, type WorkerDeps } from "./pipeline";
import { isTaskJob, onTaskFailed } from "./tasks";

/**
 * Vida dos jobs (plano de comunicação C3, 2026-10-11): batimento por job, falha definitiva conferida na fila e
 * verificador periódico. Motivo: a BullMQ marca `failed` em jobs travados sem avisar o worker que os processava, e
 * durante uma chamada longa ao modelo nada indicava que o job seguia vivo.
 */

/** Limita o batimento: o primeiro sinal passa, os seguintes só depois de `minMs` (padrão 15 s). */
export function createBeat(
  update: () => Promise<unknown>,
  opts: { now?: () => number; minMs?: number } = {},
): () => void {
  const now = opts.now ?? Date.now;
  const minMs = opts.minMs ?? 15_000;
  let last: number | null = null;
  return () => {
    const t = now();
    if (last !== null && t - last < minMs) return;
    last = t;
    void update().catch(() => {});
  };
}

export interface FailedJobTarget {
  id: string;
  queueName: string;
  data: StageJobData | TaskJobData;
  attemptsMade: number;
  getState: () => Promise<string>;
}

/**
 * Falha vinda do worker ou da fila (`QueueEvents`, que inclui o verificador de travados). Só é definitiva se a fila
 * diz `failed`; com tentativa restante vira "tentando de novo". `seen` evita tratar a mesma falha duas vezes (o mesmo
 * job pode chegar pelos dois caminhos). Devolve true quando tratou uma falha definitiva.
 */
export async function handleFinalFailure(
  job: FailedJobTarget,
  reason: string,
  deps: WorkerDeps,
  seen: Set<string>,
): Promise<boolean> {
  const ev = { repos: deps.repos, publish: deps.publish };
  const state = await job.getState();
  if (state !== "failed") {
    await handleQueueEvent(
      { type: "progress", jobId: job.id, at: nowUtc(), stage: "retrying", progress: 0 },
      ev,
    );
    return false;
  }
  const key = `${job.id}:${job.attemptsMade}`;
  if (seen.has(key)) return false;
  seen.add(key);
  if (seen.size > 5000) seen.clear();
  const err = new Error(reason);
  if (isTaskJob(job.data)) await onTaskFailed(job.data, err, deps, job.queueName);
  else await onStageFailed(job.data, err, deps);
  await handleQueueEvent(
    { type: "failed", jobId: job.id, at: nowUtc(), error: reason, attempts: job.attemptsMade },
    ev,
  );
  return true;
}

const IN_PROGRESS = ["queued", "estimating", "running"] as const;

/**
 * Verificador periódico (a cada 60 s no worker): para execuções em andamento que ninguém abriu, confere a fila,
 * trata falhas que o espelho perdeu, recupera execuções presas e mantém a notificação "Ingestão parada" (2 min sem
 * sinal, CM-2). `acquire` é uma trava no Redis para dois workers não rodarem juntos.
 */
export async function runSweep(
  deps: WorkerDeps,
  opts: { acquire: () => Promise<boolean>; state: QueueStateFn; now?: () => Date },
): Promise<{ ran: boolean }> {
  if (!(await opts.acquire())) return { ran: false };
  const now = (opts.now ?? (() => new Date()))();
  const { repos } = deps;
  const inProgress = repos.ingestionRuns.list({ status: [...IN_PROGRESS] });
  const active = new Set(inProgress.map((r) => r.id));
  for (const run of inProgress) {
    const { failed } = await syncRunJobs(repos, run.id, opts.state, now);
    for (const j of failed) {
      await deps.publish({ type: "job.error", jobId: j.id, error: j.error ?? "Tarefa falhou" });
      const err = new Error(j.error ?? "Tarefa falhou");
      const task = taskOfJob(j);
      if (task)
        await onTaskFailed(
          { kind: "task", type: task.type, key: task.key, payload: task.payload },
          err,
          deps,
          task.queue,
        );
      else await onStageFailed({ runId: run.id, stage: j.type } as StageJobData, err, deps);
    }
    if (healStuckRun(repos, run.id)) await notifyRun(deps, run.id);
    const current = repos.ingestionRuns.get(run.id);
    const stale =
      current && IN_PROGRESS.includes(current.status as (typeof IN_PROGRESS)[number])
        ? runJobs(repos, run.id).some((j) => isJobStale(j, now))
        : false;
    if (stale) {
      const { notification, created } = repos.notifications.upsert({
        kind: "ingestion.stuck",
        subjectKind: RUN_SUBJECT,
        subjectId: run.id,
        title: "Ingestão parada",
        body: "Sem sinal de atividade há mais de 2 minutos. Abra a execução para refazer a etapa ou cancelar.",
        actionUrl: `/ingestao/${run.id}`,
        severity: "warning",
      });
      await deps.publish({
        type: created ? "notification.created" : "notification.updated",
        notification,
      });
    } else {
      for (const n of repos.notifications.resolveSubject(RUN_SUBJECT, run.id, ["ingestion.stuck"]))
        await deps.publish({ type: "notification.updated", notification: n });
    }
  }
  // execuções que saíram do andamento não deixam "Ingestão parada" aberta
  for (const n of repos.notifications.list({ status: "open" })) {
    if (n.kind !== "ingestion.stuck" || active.has(n.subjectId)) continue;
    for (const r of repos.notifications.resolveSubject(RUN_SUBJECT, n.subjectId, [
      "ingestion.stuck",
    ]))
      await deps.publish({ type: "notification.updated", notification: r });
  }
  return { ran: true };
}
