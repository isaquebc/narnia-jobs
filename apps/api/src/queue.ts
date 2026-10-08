import {
  type EnqueueTaskResult,
  enqueueStage,
  enqueueTask,
  type QueueName,
  type Repos,
  STAGES,
  type StageJobData,
  type StageName,
  type TaskJobData,
} from "@narnia-jobs/core";
import type { Job as MirrorJob } from "@narnia-jobs/shared";
import { Job, type Queue } from "bullmq";

/** Fronteira entre a API e a fila (BullMQ em produção, fake nos testes). */
export interface EnqueueTaskRequest {
  queue: QueueName;
  type: string;
  key: string;
  payload?: Record<string, unknown>;
  profileId?: string | null;
}

export interface QueueAdapter {
  enqueue(runId: string, stage: StageName): Promise<MirrorJob>;
  /** Job de tarefa fora da cadeia de ingestão (F02 §2.9-1); idempotente com pendente de mesma chave. */
  enqueueTask(req: EnqueueTaskRequest): Promise<EnqueueTaskResult>;
  /** "removed" (estava na fila), "active" (não dá para cancelar em execução) ou "missing". */
  cancel(jobId: string): Promise<"removed" | "active" | "missing">;
  retry(jobId: string): Promise<boolean>;
}

type Queues = Record<"ingest" | "ocr" | "extract", Queue<StageJobData>>;
/** As mesmas filas aceitam dados de tarefa (F02 §2.9-1); o tipo genérico da BullMQ é só anotação. */
type TaskQueues = Record<"ingest" | "ocr" | "extract", { add: Queue<TaskJobData>["add"] }>;

export class BullQueueAdapter implements QueueAdapter {
  constructor(
    private readonly queues: Queues,
    private readonly repos: Repos,
  ) {}

  private queueFor(jobId: string): Queue<StageJobData> | null {
    const mirror = this.repos.jobs.get(jobId);
    if (!mirror) return null;
    return this.queues[mirror.queue];
  }

  async enqueue(runId: string, stage: StageName): Promise<MirrorJob> {
    return enqueueStage({ queues: this.queues, repos: this.repos, runId, stage });
  }

  async enqueueTask(req: EnqueueTaskRequest): Promise<EnqueueTaskResult> {
    return enqueueTask({
      queues: this.queues as unknown as TaskQueues,
      repos: this.repos,
      ...req,
    });
  }

  async cancel(jobId: string) {
    const queue = this.queueFor(jobId);
    if (!queue) return "missing" as const;
    const job = await Job.fromId(queue, jobId);
    if (!job) return "missing" as const;
    const state = await job.getState();
    if (state === "active") return "active" as const;
    await job.remove();
    return "removed" as const;
  }

  async retry(jobId: string) {
    const mirror = this.repos.jobs.get(jobId);
    if (!mirror) return false;
    const queue = this.queues[mirror.queue];
    const job = await Job.fromId(queue, jobId);
    if (job && (await job.getState()) === "failed") {
      await job.retry();
      return true;
    }
    if (job) await job.remove();
    const stage = mirror.type as StageName;
    if (!(stage in STAGES)) return false;
    await enqueueStage({
      queues: this.queues,
      repos: this.repos,
      runId: mirror.parentId ?? "",
      stage,
    });
    return true;
  }
}
