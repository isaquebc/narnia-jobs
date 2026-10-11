import type { Job } from "@narnia-jobs/shared";
import { nowUtc } from "@narnia-jobs/shared";
import type { Repos } from "../db/repos";
import { taskOfJob } from "../jobs/tasks";

/**
 * Recuperação de execuções presas (plano de comunicação C3, 2026-10-11). O espelho `job` pode mentir: quando a
 * BullMQ desiste de um job travado ("job stalled more than allowable limit"), quem marca `failed` é o verificador de
 * travados da fila, e o `worker.on("failed")` de quem processava não dispara. Por isso a API (ao abrir) e o
 * verificador periódico do worker consultam o estado real na fila antes de confiar no espelho.
 */
export type QueueJobState = "waiting" | "active" | "completed" | "failed" | "delayed" | "missing";
export type QueueStateFn = (
  job: Job,
) => Promise<{ state: QueueJobState; failedReason?: string | null }>;

/** Sem nenhum sinal (evento, progresso ou batimento) por mais que isso, a etapa ativa "parece parada" (CM-2). */
export const STALE_AFTER_MS = 120_000;

const LIVE = new Set<Job["status"]>(["queued", "active", "stalled"]);
const IN_PROGRESS = new Set(["queued", "estimating", "running"]);

/** Jobs da execução: etapas de CV/texto (`parentId`) e tarefas do GitHub (`runId` dentro da tarefa). */
export function runJobs(repos: Repos, runId: string): Job[] {
  return repos.jobs
    .list({ limit: 1000 })
    .filter((j) => j.parentId === runId || taskOfJob(j)?.runId === runId);
}

/** Ativo e sem sinal há mais de `STALE_AFTER_MS`. */
export function isJobStale(job: Job, now: Date = new Date(), ms = STALE_AFTER_MS): boolean {
  if (job.status !== "active" && job.status !== "stalled") return false;
  const last = Date.parse(job.updatedAt ?? job.startedAt ?? job.createdAt);
  return Number.isFinite(last) && now.getTime() - last > ms;
}

/**
 * Para cada job vivo no espelho, confere a fila; `failed` ou `missing` viram erro no espelho (com o motivo da fila).
 * Devolve os jobs que acabaram de ser marcados como falhos (o worker os repassa a onTaskFailed/onStageFailed).
 */
export async function syncRunJobs(
  repos: Repos,
  runId: string,
  state: QueueStateFn,
): Promise<{ failed: Job[] }> {
  const failed: Job[] = [];
  for (const job of runJobs(repos, runId)) {
    if (!LIVE.has(job.status)) continue;
    const s = await state(job);
    if (s.state !== "failed" && s.state !== "missing") continue;
    const error =
      s.state === "missing"
        ? "Tarefa interrompida: o job sumiu da fila"
        : (s.failedReason ?? "Tarefa falhou na fila");
    repos.jobs.applyEvent({ jobId: job.id, type: "failed", at: nowUtc(), error });
    const updated = repos.jobs.get(job.id);
    if (updated) failed.push(updated);
  }
  return { failed };
}

/**
 * Execução em andamento sem nenhum job vivo e com job em erro está presa: vira erro. Para tarefas (GitHub,
 * reconciliação, conferência) guarda `params.failedTask`, e o "Tentar de novo" refaz só ela; etapas de CV/texto são
 * refeitas pelo retry do job. Devolve true se mudou algo.
 */
export function healStuckRun(repos: Repos, runId: string): boolean {
  const run = repos.ingestionRuns.get(runId);
  if (!run || !IN_PROGRESS.has(run.status)) return false;
  const jobs = runJobs(repos, runId);
  if (jobs.length === 0 || jobs.some((j) => LIVE.has(j.status))) return false;
  const failed = jobs.find((j) => j.status === "error");
  if (!failed) return false;
  const task = taskOfJob(failed);
  if (task) {
    repos.ingestionRuns.setParams(runId, {
      ...run.params,
      failedTask: { queue: task.queue, type: task.type, key: task.key, payload: task.payload },
    });
  }
  repos.ingestionRuns.setStatus(runId, "error", { error: failed.error ?? "Tarefa falhou" });
  return true;
}
