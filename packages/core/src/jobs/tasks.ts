import type { Job } from "@narnia-jobs/shared";
import { nowUtc } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import { DEFAULT_JOB_OPTIONS, type QueueName } from "../ingest/chain";

/**
 * Jobs de tarefa, fora da cadeia de ingestão (F02 §2.9-1): `profile.analyze` em F02, geração de CV em F05, etc.
 * Mesma fila e mesmo espelho `job` das etapas; o worker despacha por `data.kind` ("task" aqui, ausente = etapa).
 */
export interface TaskJobData {
  kind: "task";
  type: string;
  key: string;
  payload: Record<string, unknown>;
}

export const TERMINAL_JOB_STATUSES: ReadonlySet<Job["status"]> = new Set([
  "done",
  "error",
  "cancelled",
]);

/** Ids customizados da BullMQ não podem conter ':'; `task__<tipo>__<chave>`. */
export function taskJobId(type: string, key: string): string {
  const safe = (s: string) => s.replace(/:/g, "_");
  return `task__${safe(type)}__${safe(key)}`;
}

/** Job já existente na fila (subconjunto do `Job` da BullMQ). */
export interface TaskJobHandle {
  getState(): Promise<string>;
  remove(): Promise<unknown>;
}

export interface TaskQueueLike {
  add(name: string, data: TaskJobData, opts: { jobId: string }): Promise<unknown>;
  /** Necessário para reenfileirar depois de uma falha: a BullMQ ignora `add` com id de job ainda presente. */
  getJob?(id: string): Promise<TaskJobHandle | null | undefined>;
}

export interface EnqueueTaskInput {
  queues: Record<QueueName, TaskQueueLike>;
  repos: Repos;
  queue: QueueName;
  type: string;
  key: string;
  payload?: Record<string, unknown>;
  profileId?: string | null;
  at?: string;
}

export interface EnqueueTaskResult {
  job: Job;
  /** false quando já havia um job pendente com a mesma chave (idempotência). */
  enqueued: boolean;
}

/** Enfileira a tarefa e registra o espelho `queued`; com um job pendente de mesma chave, devolve-o sem enfileirar. */
export async function enqueueTask(input: EnqueueTaskInput): Promise<EnqueueTaskResult> {
  const id = taskJobId(input.type, input.key);
  const at = input.at ?? nowUtc();
  const existing = input.repos.jobs.get(id);
  if (existing && !TERMINAL_JOB_STATUSES.has(existing.status)) {
    return { job: existing, enqueued: false };
  }
  const queue = input.queues[input.queue];
  if (existing) {
    // auditoria F02 (1): com `removeOnFail: false` o job falho continua na fila com o mesmo id e o `add` seria ignorado
    const old = await queue.getJob?.(id);
    if (old) {
      if ((await old.getState()) === "active") return { job: existing, enqueued: false };
      await old.remove();
    }
  }
  const data: TaskJobData = {
    kind: "task",
    type: input.type,
    key: input.key,
    payload: input.payload ?? {},
  };
  const job = existing
    ? (input.repos.jobs.requeue(id, at) as Job)
    : input.repos.jobs.upsertQueued({
        id,
        queue: input.queue,
        type: input.type,
        parentId: null,
        profileId: input.profileId ?? null,
        payload: { ...data },
        stage: input.type,
        at,
      });
  await queue.add(input.type, data, { jobId: id });
  return { job, enqueued: true };
}

export { DEFAULT_JOB_OPTIONS as TASK_JOB_OPTIONS };
