import {
  DOCUMENT_TASKS,
  INGEST_TASKS,
  POSTING_TASKS,
  type StageJobData,
  type TaskJobData,
} from "@narnia-jobs/core";
import {
  githubPrepare,
  githubRepo,
  githubSynthesis,
  ingestReconcile,
  ingestReviewCheck,
} from "./ingest/github";
import { setRunStatus } from "./ingest/status";
import type { WorkerDeps } from "./pipeline";
import { analyzeProfiles } from "./processors/analyze-profiles";
import { cvGenerate } from "./processors/cv-generate";
import { postingExtract } from "./processors/posting-extract";

/**
 * Jobs de tarefa (F02 §2.9-1): fora da cadeia de ingestão, despachados por `data.kind === "task"`.
 * Mesmas filas e mesmo espelho `job` das etapas; o handler recebe o payload e devolve o `result` do espelho.
 */
export interface TaskContext {
  jobId: string;
  progress: (pct: number, note?: string) => Promise<void>;
}

export type TaskHandler = (
  data: TaskJobData,
  ctx: TaskContext,
  deps: WorkerDeps,
) => Promise<Record<string, unknown>>;

export type TaskErrorCode = "unknown_task";

export class TaskError extends Error {
  readonly code: TaskErrorCode;
  constructor(code: TaskErrorCode, message: string) {
    super(message);
    this.name = "TaskError";
    this.code = code;
  }
}

export const TASK_HANDLERS: Record<string, TaskHandler> = {
  "profile.analyze": analyzeProfiles,
  [INGEST_TASKS.githubPrepare]: githubPrepare,
  [INGEST_TASKS.githubRepo]: githubRepo,
  [INGEST_TASKS.githubSynthesis]: githubSynthesis,
  [INGEST_TASKS.reconcile]: ingestReconcile,
  [INGEST_TASKS.reviewCheck]: ingestReviewCheck,
  [POSTING_TASKS.extract]: postingExtract,
  [DOCUMENT_TASKS.generate]: cvGenerate,
};

export function isTaskJob(data: StageJobData | TaskJobData): data is TaskJobData {
  return (data as TaskJobData).kind === "task";
}

export async function processTask(
  data: TaskJobData,
  ctx: TaskContext,
  deps: WorkerDeps,
): Promise<Record<string, unknown>> {
  const handler = TASK_HANDLERS[data.type];
  if (!handler) throw new TaskError("unknown_task", `Tarefa desconhecida: ${data.type}`);
  const result = await handler(data, ctx, deps);
  await ctx.progress(100);
  return result;
}

/** Estados em que uma execução ainda depende de tarefas: falha definitiva de tarefa nesses estados vira "erro". */
const RUN_IN_PROGRESS = new Set(["queued", "estimating", "running"]);

/**
 * Falha definitiva (tentativas esgotadas) de uma tarefa de ingestão (regressão 2026-10-11): a execução saía de
 * cena presa em "running". Marca a execução como erro, guarda a tarefa em `params.failedTask` e o
 * `POST /api/ingestions/:id/retry` reenfileira só ela.
 */
export async function onTaskFailed(
  data: TaskJobData,
  error: Error,
  deps: WorkerDeps,
  queue = "ingest",
): Promise<void> {
  if (!data.type.startsWith("ingest.")) return;
  const id = typeof data.payload.runId === "string" ? data.payload.runId : null;
  if (!id) return;
  const run = deps.repos.ingestionRuns.get(id);
  if (!run || !RUN_IN_PROGRESS.has(run.status)) return;
  deps.repos.ingestionRuns.setParams(id, {
    ...run.params,
    failedTask: { queue, type: data.type, key: data.key, payload: data.payload },
  });
  await setRunStatus(deps, id, "error", { error: error.message || String(error) });
}
