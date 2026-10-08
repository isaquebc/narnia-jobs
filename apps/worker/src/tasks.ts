import type { StageJobData, TaskJobData } from "@narnia-jobs/core";
import type { WorkerDeps } from "./pipeline";
import { analyzeProfiles } from "./processors/analyze-profiles";

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
