import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createRepos,
  createTesseractRecognizer,
  defaultGhConfigDir,
  enqueueStage,
  enqueueTask,
  FAKE_GH_STATE_FILENAME,
  migrate,
  openDatabase,
  renderPdfPages,
  resolveGhRuntime,
  type StageJobData,
  type StageName,
  type TaskJobData,
} from "@narnia-jobs/core";
import type { Provider } from "@narnia-jobs/providers";
import { nowUtc, type WsEvent } from "@narnia-jobs/shared";
import { type Job, Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { handleQueueEvent } from "./events";
import { type OcrDeps, onStageFailed, processStage, type WorkerDeps } from "./pipeline";
import { createQueues, QUEUE_NAMES } from "./queues";
import { isTaskJob, processTask } from "./tasks";

type JobData = StageJobData | TaskJobData;
/** Rótulo de etapa para os eventos: etapas usam `stage`, tarefas usam o `type` (F02 §2.9-1). */
const stageOf = (data: JobData) => (isTaskJob(data) ? data.type : data.stage);

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
  queues: Record<(typeof QUEUE_NAMES)[number], Queue<JobData>>;
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
  migrate(db, { backupDir: join(dirname(opts.dbPath), "backups") });
  const repos = createRepos(db);
  const queues = createQueues({
    connection,
    prefix,
    QueueCtor: Queue as unknown as new (
      name: string,
      opts: { connection: unknown; prefix: string; defaultJobOptions?: Record<string, unknown> },
    ) => Queue<JobData>,
  });

  const publish = async (event: WsEvent) => {
    await connection.publish(wsChannel(prefix), JSON.stringify(event));
  };
  const ghConfigDir = defaultGhConfigDir();
  const deps: WorkerDeps = {
    repos,
    dataDir: opts.dataDir,
    provider: opts.provider,
    ocr: opts.ocr ?? defaultOcrDeps,
    enqueue: async (runId: string, stage: StageName) => {
      await enqueueStage({ queues, repos, runId, stage });
    },
    enqueueTask: async (req) =>
      enqueueTask({
        queues: queues as unknown as Parameters<typeof enqueueTask>[0]["queues"],
        repos,
        ...req,
      }),
    publish,
    // F03-1: credencial lida a cada uso (o lançador pode renovar o token do host); mock usa o gh falso
    gh: () =>
      resolveGhRuntime({
        settings: repos.settings,
        configDir: ghConfigDir,
        fake:
          opts.provider.id === "mock"
            ? { stateFile: join(opts.dataDir, FAKE_GH_STATE_FILENAME) }
            : null,
        snapshots: { dataDir: opts.dataDir, repos },
      }).client,
  };

  const workers = QUEUE_NAMES.map((name) => {
    const worker = new Worker<JobData>(
      name,
      async (job) => {
        const data = job.data;
        const progress = async (pct: number, note?: string) => {
          await job.updateProgress({ pct, stage: stageOf(data), note: note ?? null });
        };
        if (isTaskJob(data)) return processTask(data, { jobId: String(job.id), progress }, deps);
        return processStage(data, { runId: data.runId, jobId: String(job.id), progress }, deps);
      },
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
          stage: stageOf(job.data),
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
          stage: stageOf(job.data),
        },
        ev,
      );
    });
    worker.on("completed", (job, result) => {
      void handleQueueEvent(
        {
          type: "completed",
          jobId: String(job.id),
          at: nowUtc(),
          result,
          stage: stageOf(job.data),
        },
        ev,
      );
    });
    worker.on("failed", (job: Job<JobData> | undefined, err) => {
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
      if (!isTaskJob(job.data)) void onStageFailed(job.data, err, deps);
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
