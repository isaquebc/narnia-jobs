import {
  dueScheduledTasks,
  isScheduledTaskId,
  MAIL_MODEL_KEY,
  POSTING_TASKS,
  recordUsage,
  resolveModel,
  runScheduledTask,
  SCHEDULED_RUN_TASK,
  type TaskJobData,
  TERMINAL_JOB_STATUSES,
  taskJobId,
  usageFromSdkResult,
} from "@narnia-jobs/core";
import { SCHEDULED_TASK_IDS } from "@narnia-jobs/shared";
import type { WorkerDeps } from "../pipeline";
import type { TaskContext } from "../tasks";

/** Tarefa `scheduled.run` (F14-12): roda a rotina agendada com log, itens e próxima execução. */
export async function scheduledRun(
  data: TaskJobData,
  _ctx: TaskContext,
  deps: WorkerDeps,
): Promise<Record<string, unknown>> {
  const taskId = String(data.payload.taskId ?? "");
  if (!isScheduledTaskId(taskId)) throw new Error(`Tarefa agendada desconhecida: ${taskId}`);
  const trigger = data.payload.trigger === "manual" ? "manual" : "schedule";
  const r = await runScheduledTask({
    repos: deps.repos,
    dataDir: deps.dataDir,
    taskId,
    trigger,
    publish: deps.publish,
    mailSource: () => deps.mailSource?.() ?? null,
    services: {
      // F14/M4: o e-mail vai ao modelo barato, sem tools; o uso entra no medidor como qualquer chamada
      classifyMail: async (input) => {
        const model = resolveModel(deps.repos.settings, MAIL_MODEL_KEY, "haiku");
        const r = await deps.provider.mailClassify({ ...input, model });
        recordUsage(
          deps.repos,
          deps.dataDir,
          usageFromSdkResult(r.sdk, { category: "mail.classify", model, jobId: _ctx.jobId }),
        );
        return r.output;
      },
      enqueuePostingExtract: async (postingId) => {
        await deps.enqueueTask({
          queue: "extract",
          type: POSTING_TASKS.extract,
          key: `${postingId}-${Date.now()}`,
          payload: { postingId },
        });
      },
    },
  });
  return { runId: r.id, status: r.status, skipped: r.skipped ?? false };
}

/** Estado do job na fila `scheduled` ("missing" = não está mais no Redis). */
export type ScheduledJobState = (jobId: string) => Promise<string>;

/**
 * Laço do agendador (F14-12): enfileira as tarefas devidas na fila `scheduled`. O `enqueueTask` é idempotente por
 * chave enquanto o job está pendente, então rodar o laço de novo antes da execução começar não duplica nada.
 *
 * Revisão do M1: antes, cura dois estados que tirariam a tarefa do laço para sempre: execução em "running" cujo job
 * já terminou ou sumiu da fila (vira erro) e espelho do job pendente sem job no Redis (Redis zerado, `reset`): o
 * espelho é cancelado e a tarefa entra de novo.
 */
export async function enqueueDueScheduledTasks(
  deps: WorkerDeps,
  now = new Date(),
  jobState?: ScheduledJobState,
): Promise<string[]> {
  for (const taskId of SCHEDULED_TASK_IDS) {
    const jobId = taskJobId(SCHEDULED_RUN_TASK, taskId);
    const mirror = deps.repos.jobs.get(jobId);
    const pending = mirror && !TERMINAL_JOB_STATUSES.has(mirror.status);
    const gone = pending && jobState ? (await jobState(jobId)) === "missing" : false;
    if (deps.repos.scheduled.isRunning(taskId) && (!pending || gone))
      deps.repos.scheduled.failRunning(
        "Interrompida: o job da execução terminou sem fechar o registro",
        now.toISOString(),
        taskId,
      );
    if (gone) deps.repos.jobs.applyEvent({ jobId, type: "cancelled", at: now.toISOString() });
  }
  const due = dueScheduledTasks(deps.repos, now);
  for (const taskId of due)
    await deps.enqueueTask({
      queue: "scheduled",
      type: SCHEDULED_RUN_TASK,
      key: taskId,
      payload: { taskId, trigger: "schedule" },
    });
  return due;
}
