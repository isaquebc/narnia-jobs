import {
  enqueueStage,
  type Repos,
  STAGES,
  type StageJobData,
  type StageName,
} from "@narnia-jobs/core";
import type { Job as MirrorJob } from "@narnia-jobs/shared";
import { Job, type Queue } from "bullmq";

/** Fronteira entre a API e a fila (BullMQ em produção, fake nos testes). */
export interface QueueAdapter {
  enqueue(runId: string, stage: StageName): Promise<MirrorJob>;
  /** "removed" (estava na fila), "active" (não dá para cancelar em execução) ou "missing". */
  cancel(jobId: string): Promise<"removed" | "active" | "missing">;
  retry(jobId: string): Promise<boolean>;
}

type Queues = Record<"ingest" | "ocr" | "extract", Queue<StageJobData>>;

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
