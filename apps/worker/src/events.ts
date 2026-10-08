import type { JobEvent, Repos } from "@narnia-jobs/core";
import type { WsEvent } from "@narnia-jobs/shared";

export interface EventDeps {
  repos: Repos;
  publish: (event: WsEvent) => Promise<void>;
}

/** Evento da BullMQ → espelho em `job` (idempotente) → evento WS para a bandeja de atividades. */
export async function handleQueueEvent(event: JobEvent, deps: EventDeps): Promise<void> {
  const applied = deps.repos.jobs.applyEvent(event);
  if (!applied) return;
  const job = deps.repos.jobs.get(event.jobId);
  if (!job) return;
  switch (event.type) {
    case "active":
    case "progress":
      await deps.publish({
        type: "job.progress",
        jobId: job.id,
        stage: event.stage ?? job.stage,
        progress: event.progress ?? job.progress,
      });
      return;
    case "stalled":
      await deps.publish({
        type: "job.progress",
        jobId: job.id,
        stage: "stalled",
        progress: job.progress,
      });
      return;
    case "completed":
      await deps.publish({ type: "job.done", jobId: job.id });
      return;
    case "failed":
      await deps.publish({ type: "job.error", jobId: job.id, error: event.error ?? "erro" });
      return;
    case "cancelled":
      await deps.publish({ type: "job.error", jobId: job.id, error: "cancelado" });
      return;
  }
}
