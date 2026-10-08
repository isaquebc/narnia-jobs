import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  createRepos,
  createTesseractRecognizer,
  enqueueStage,
  migrate,
  openDatabase,
  renderPdfPages,
  type StageJobData,
  type StageName,
} from "@narnia-jobs/core";
import type { Provider } from "@narnia-jobs/providers";
import { nowUtc, type WsEvent } from "@narnia-jobs/shared";
import { type Job, Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { handleQueueEvent } from "./events";
import { type OcrDeps, onStageFailed, processStage, type WorkerDeps } from "./pipeline";
import { createQueues, QUEUE_NAMES } from "./queues";

export interface StartWorkersOptions {
  redisUrl: string;
  prefix?: string;
  dbPath: string;
  dataDir: string;
  provider: Provider;
  ocr?: OcrDeps;
  concurrency?: Partial<Record<(typeof QUEUE_NAMES)[number], number>>;
  heartbeatMs?: number;
  log?: (line: string) => void;
}

export interface StartedWorkers {
  queues: Record<(typeof QUEUE_NAMES)[number], Queue<StageJobData>>;
  workers: Worker[];
  heartbeat: () => Promise<string | null>;
  close: () => Promise<void>;
}

export const wsChannel = (prefix: string) => `${prefix}:ws`;
export const heartbeatKey = (prefix: string) => `${prefix}:worker:heartbeat`;

const DEFAULT_CONCURRENCY = { ingest: 2, ocr: 1, extract: 2 } as const;

export const defaultOcrDeps: OcrDeps = {
  render: (pdfPath, outDir) => renderPdfPages(pdfPath, outDir),
  createRecognizer: () => createTesseractRecognizer(),
};

/** Sobe um Worker por fila, espelha eventos em `job`, publica eventos WS no Redis e mantém o heartbeat. */
export async function startWorkers(opts: StartWorkersOptions): Promise<StartedWorkers> {
  const prefix = opts.prefix ?? "narnia";
  const log = opts.log ?? (() => {});
  const connection = new IORedis(opts.redisUrl, { maxRetriesPerRequest: null });
  mkdirSync(dirname(opts.dbPath), { recursive: true });
  mkdirSync(opts.dataDir, { recursive: true });
  const db = openDatabase(opts.dbPath);
  migrate(db);
  const repos = createRepos(db);
  const queues = createQueues({
    connection,
    prefix,
    QueueCtor: Queue as unknown as new (
      name: string,
      opts: { connection: unknown; prefix: string; defaultJobOptions?: Record<string, unknown> },
    ) => Queue<StageJobData>,
  });

  const publish = async (event: WsEvent) => {
    await connection.publish(wsChannel(prefix), JSON.stringify(event));
  };
  const deps: WorkerDeps = {
    repos,
    dataDir: opts.dataDir,
    provider: opts.provider,
    ocr: opts.ocr ?? defaultOcrDeps,
    enqueue: async (runId: string, stage: StageName) => {
      await enqueueStage({ queues, repos, runId, stage });
    },
  };

  const workers = QUEUE_NAMES.map((name) => {
    const worker = new Worker<StageJobData>(
      name,
      async (job) =>
        processStage(
          job.data,
          {
            runId: job.data.runId,
            jobId: String(job.id),
            progress: async (pct, note) => {
              await job.updateProgress({ pct, stage: job.data.stage, note: note ?? null });
            },
          },
          deps,
        ),
      {
        connection,
        prefix,
        concurrency: opts.concurrency?.[name] ?? DEFAULT_CONCURRENCY[name],
      },
    );
    const ev = { repos, publish };
    worker.on("active", (job) => {
      void handleQueueEvent(
        {
          type: "active",
          jobId: String(job.id),
          at: nowUtc(),
          attempts: job.attemptsMade + 1,
          stage: job.data.stage,
        },
        ev,
      );
    });
    worker.on("progress", (job, progress) => {
      const p = typeof progress === "number" ? progress : (progress as { pct?: number }).pct;
      void handleQueueEvent(
        {
          type: "progress",
          jobId: String(job.id),
          at: nowUtc(),
          progress: p ?? 0,
          stage: job.data.stage,
        },
        ev,
      );
    });
    worker.on("completed", (job, result) => {
      void handleQueueEvent(
        { type: "completed", jobId: String(job.id), at: nowUtc(), result, stage: job.data.stage },
        ev,
      );
    });
    worker.on("failed", (job: Job<StageJobData> | undefined, err) => {
      if (!job) return;
      const attempts = job.opts.attempts ?? 1;
      if (job.attemptsMade < attempts) {
        // ainda vai tentar de novo: não é falha definitiva
        void handleQueueEvent(
          { type: "progress", jobId: String(job.id), at: nowUtc(), stage: "retrying", progress: 0 },
          ev,
        );
        return;
      }
      log(`[worker] falha definitiva em ${job.id}: ${err.message}`);
      void onStageFailed(job.data, err, deps);
      void handleQueueEvent(
        {
          type: "failed",
          jobId: String(job.id),
          at: nowUtc(),
          error: err.message,
          attempts: job.attemptsMade,
        },
        ev,
      );
    });
    worker.on("stalled", (jobId) => {
      void handleQueueEvent({ type: "stalled", jobId, at: nowUtc() }, ev);
    });
    worker.on("error", (err) => log(`[worker:${name}] erro: ${err.message}`));
    return worker;
  });

  const ttlSeconds = Math.max(5, Math.ceil(((opts.heartbeatMs ?? 10_000) * 3) / 1000));
  const beat = async () => {
    await connection.set(heartbeatKey(prefix), nowUtc(), "EX", ttlSeconds);
  };
  await beat();
  const timer = setInterval(() => void beat(), opts.heartbeatMs ?? 10_000);

  return {
    queues,
    workers,
    heartbeat: () => connection.get(heartbeatKey(prefix)),
    close: async () => {
      clearInterval(timer);
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all(Object.values(queues).map((q) => q.close()));
      await connection.quit();
      db.close();
    },
  };
}
