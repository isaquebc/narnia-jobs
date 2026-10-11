import { type Job, JobSchema, type JobStatus } from "@narnia-jobs/shared";
import type { Db } from "../open";
import { json, type Row, str } from "../sql";

export type JobEventType = "active" | "progress" | "completed" | "failed" | "stalled" | "cancelled";

export interface JobEvent {
  jobId: string;
  type: JobEventType;
  /** Instante do evento em UTC. */
  at: string;
  progress?: number;
  stage?: string;
  result?: unknown;
  error?: string;
  attempts?: number;
}

export interface JobQueuedInput {
  id: string;
  queue: Job["queue"];
  type: string;
  parentId: string | null;
  profileId: string | null;
  payload: Record<string, unknown>;
  stage: string;
  at: string;
}

const TERMINAL: ReadonlySet<JobStatus> = new Set(["done", "error", "cancelled"]);

export interface JobsRepo {
  /** Registra o job no momento do enqueue (BullMQ é a fonte da verdade; esta tabela é o espelho). */
  upsertQueued(input: JobQueuedInput): Job;
  /** Aplica um evento da BullMQ de forma idempotente; devolve false se o job não existe no espelho. */
  applyEvent(event: JobEvent): boolean;
  get(id: string): Job | null;
  list(filter?: { status?: JobStatus; parentId?: string; limit?: number }): Job[];
  /** Volta um job terminal (error/cancelled) para `queued` quando o usuário pede "tentar de novo". */
  requeue(id: string, at: string): Job | null;
}

function map(r: Row): Job {
  return JobSchema.parse({
    id: String(r.id),
    queue: String(r.queue),
    type: String(r.type),
    parentId: str(r.parent_id),
    profileId: str(r.profile_id),
    status: String(r.status),
    progress: Number(r.progress),
    stage: String(r.stage),
    payload: json(r.payload_json, {}),
    result: json(r.result_json, null),
    error: str(r.error),
    attempts: Number(r.attempts),
    createdAt: String(r.created_at),
    startedAt: str(r.started_at),
    finishedAt: str(r.finished_at),
    updatedAt: str(r.updated_at),
  });
}

export function jobsRepo(db: Db): JobsRepo {
  const upsert = db.prepare(
    `insert into job (id, queue, type, parent_id, profile_id, status, progress, stage, payload_json, attempts, created_at, updated_at)
     values (@id, @queue, @type, @parent_id, @profile_id, 'queued', 0, @stage, @payload_json, 0, @at, @at)
     on conflict (id) do update set stage = excluded.stage, payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
  );
  const get = db.prepare("select * from job where id = ?");
  const update = db.prepare(
    `update job set status = @status, progress = @progress, stage = @stage, result_json = @result_json, error = @error,
       attempts = @attempts, started_at = @started_at, finished_at = @finished_at, updated_at = @updated_at where id = @id`,
  );

  const repo: JobsRepo = {
    upsertQueued(input) {
      upsert.run({
        id: input.id,
        queue: input.queue,
        type: input.type,
        parent_id: input.parentId,
        profile_id: input.profileId,
        stage: input.stage,
        payload_json: JSON.stringify(input.payload),
        at: input.at,
      });
      return repo.get(input.id) as Job;
    },
    applyEvent(ev) {
      const row = get.get(ev.jobId) as Row | undefined;
      if (!row) return false;
      const current = map(row);
      if (TERMINAL.has(current.status)) return true; // nunca rebaixa estado terminal
      let next: Job = { ...current };
      switch (ev.type) {
        case "active":
          next = {
            ...next,
            status: "active",
            attempts: ev.attempts ?? next.attempts,
            startedAt: next.startedAt ?? ev.at,
            stage: ev.stage ?? next.stage,
          };
          break;
        case "progress":
          next = {
            ...next,
            status: "active",
            progress: ev.progress ?? next.progress,
            stage: ev.stage ?? next.stage,
            startedAt: next.startedAt ?? ev.at,
          };
          break;
        case "stalled":
          next = { ...next, status: "stalled" };
          break;
        case "completed":
          next = {
            ...next,
            status: "done",
            progress: 100,
            result: ev.result ?? null,
            finishedAt: ev.at,
            stage: ev.stage ?? next.stage,
          };
          break;
        case "failed":
          next = {
            ...next,
            status: "error",
            error: ev.error ?? "erro desconhecido",
            finishedAt: ev.at,
            attempts: ev.attempts ?? next.attempts,
          };
          break;
        case "cancelled":
          next = { ...next, status: "cancelled", finishedAt: ev.at };
          break;
      }
      update.run({
        id: next.id,
        status: next.status,
        progress: next.progress,
        stage: next.stage,
        result_json:
          next.result === null || next.result === undefined ? null : JSON.stringify(next.result),
        error: next.error,
        attempts: next.attempts,
        started_at: next.startedAt,
        finished_at: next.finishedAt,
        updated_at: ev.at,
      });
      return true;
    },
    get(id) {
      const row = get.get(id) as Row | undefined;
      return row ? map(row) : null;
    },
    requeue(id, at) {
      const row = get.get(id) as Row | undefined;
      if (!row) return null;
      const current = map(row);
      update.run({
        id,
        status: "queued",
        progress: 0,
        stage: current.type,
        result_json: null,
        error: null,
        attempts: current.attempts,
        started_at: null,
        finished_at: null,
        updated_at: at,
      });
      return repo.get(id);
    },
    list(filter = {}) {
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter.status) {
        where.push("status = ?");
        params.push(filter.status);
      }
      if (filter.parentId) {
        where.push("parent_id = ?");
        params.push(filter.parentId);
      }
      const sql = `select * from job ${where.length ? `where ${where.join(" and ")}` : ""} order by created_at desc, rowid desc limit ?`;
      params.push(filter.limit ?? 100);
      return (db.prepare(sql).all(...(params as Array<string | number>)) as Row[]).map(map);
    },
  };
  return repo;
}
