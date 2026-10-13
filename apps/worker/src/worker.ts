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
  recordPctSample,
  renderPdfPages,
  resolveBackupDir,
  resolveGhRuntime,
  type StageJobData,
  type StageName,
  type TaskJobData,
} from "@narnia-jobs/core";
import { type Provider, runWithActivity } from "@narnia-jobs/providers";
import { nowUtc, type WsEvent } from "@narnia-jobs/shared";
import { Job, Queue, QueueEvents, Worker } from "bullmq";
import IORedis from "ioredis";
import { handleQueueEvent } from "./events";
import { withPlanSampling } from "./ingest/plan-sampling";
import { createBeat, type FailedJobTarget, handleFinalFailure, runSweep, safely } from "./liveness";
import { type OcrDeps, processStage, type WorkerDeps } from "./pipeline";
import { createQueues, QUEUE_NAMES } from "./queues";
import { isTaskJob, processTask } from "./tasks";
import { traceJob } from "./trace-job";

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
  /** Intervalo do verificador de execuções presas (plano de comunicação C3); 0 desliga. */
  sweepMs?: number;
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
  migrate(db, { backupDir: resolveBackupDir(process.env, dirname(opts.dbPath)) });
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
    // aprendizado %→tokens por chamada (correções F03, item 11): um amostrador por processo
    provider: withPlanSampling(opts.provider, (s) => recordPctSample(repos.settings, s)),
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
    ghCloneTree: () =>
      resolveGhRuntime({
        settings: repos.settings,
        configDir: ghConfigDir,
        fake: opts.provider.id === "mock" ? { stateFile: null } : null,
      }).cloneTree,
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

  const seenFailures = new Set<string>();
  const toTarget = (job: Job<JobData>): FailedJobTarget => ({
    id: String(job.id),
    queueName: job.queueName,
    data: job.data,
    attemptsMade: job.attemptsMade,
    getState: () => job.getState(),
  });

  const workers = QUEUE_NAMES.map((name) => {
    const worker = new Worker<JobData>(
      name,
      async (job) => {
        const data = job.data;
        let lastPct = 0;
        const progress = async (pct: number, note?: string) => {
          lastPct = pct;
          await job.updateProgress({ pct, stage: stageOf(data), note: note ?? null });
        };
        // batimento por job durante chamadas longas ao modelo: no máximo um evento a cada 15 s (C3)
        const beat = createBeat(() =>
          job.updateProgress({ pct: lastPct, stage: stageOf(data), note: null, beat: true }),
        );
        return traceJob(data, { jobId: String(job.id), queue: name }, () =>
          runWithActivity<unknown>(beat, () =>
            isTaskJob(data)
              ? processTask(data, { jobId: String(job.id), progress }, deps)
              : processStage(data, { runId: data.runId, jobId: String(job.id), progress }, deps),
          ),
        );
      },
      {
        connection,
        prefix,
        concurrency: opts.concurrency?.[name] ?? DEFAULT_CONCURRENCY[name],
      },
    );
    const ev = { repos, publish };
    // eventos do worker: falha ao gravar o espelho ou avisar a web vira log (auditoria C: rejeição solta derrubava o
    // processo e todas as filas com ele)
    const onEvent = (label: string, e: Parameters<typeof handleQueueEvent>[0]) =>
      void safely(label, () => handleQueueEvent(e, ev), log);
    worker.on("active", (job) => {
      onEvent("evento active", {
        type: "active",
        jobId: String(job.id),
        at: nowUtc(),
        attempts: job.attemptsMade + 1,
        stage: stageOf(job.data),
      });
    });
    worker.on("progress", (job, progress) => {
      const p = typeof progress === "number" ? progress : (progress as { pct?: number }).pct;
      onEvent("evento progress", {
        type: "progress",
        jobId: String(job.id),
        at: nowUtc(),
        progress: p ?? 0,
        stage: stageOf(job.data),
      });
    });
    worker.on("completed", (job, result) => {
      onEvent("evento completed", {
        type: "completed",
        jobId: String(job.id),
        at: nowUtc(),
        result,
        stage: stageOf(job.data),
      });
    });
    worker.on("failed", (job: Job<JobData> | undefined, err) => {
      if (!job) return;
      // só é definitiva se a fila diz "failed"; com tentativa restante vira "tentando de novo" (C3)
      void safely(
        `falha definitiva em ${job.id}`,
        async () => {
          if (await handleFinalFailure(toTarget(job), err.message, deps, seenFailures))
            log(`[worker] falha definitiva em ${job.id}: ${err.message}`);
        },
        log,
      );
    });
    worker.on("stalled", (jobId) => {
      onEvent("evento stalled", { type: "stalled", jobId, at: nowUtc() });
    });
    worker.on("error", (err) => log(`[worker:${name}] erro: ${err.message}`));
    return worker;
  });

  // eventos da fila: o verificador de travados da BullMQ marca "failed" sem passar pelo worker que processava (C3)
  const eventsConnection = new IORedis(opts.redisUrl, { maxRetriesPerRequest: null });
  const queueEvents = QUEUE_NAMES.map((name) => {
    const qe = new QueueEvents(name, { connection: eventsConnection, prefix });
    qe.on("failed", ({ jobId, failedReason }) => {
      void safely(
        `falha definitiva em ${jobId} (fila)`,
        async () => {
          const job = await Job.fromId<JobData>(queues[name], jobId);
          if (job) await handleFinalFailure(toTarget(job), failedReason, deps, seenFailures);
        },
        log,
      );
    });
    qe.on("error", (err) => log(`[worker:events:${name}] erro: ${err.message}`));
    return qe;
  });

  // verificador periódico de execuções presas, com trava no Redis para dois workers não rodarem juntos (C3)
  const sweepMs = opts.sweepMs ?? 60_000;
  const sweep = () =>
    runSweep(deps, {
      acquire: async () =>
        (await connection.set(
          `${prefix}:sweeper`,
          "1",
          "EX",
          Math.max(5, Math.floor(sweepMs / 1000) - 5),
          "NX",
        )) === "OK",
      state: async (mirror) => {
        const job = await Job.fromId(queues[mirror.queue], mirror.id);
        if (!job) return { state: "missing" as const };
        const raw = await job.getState();
        const known = ["waiting", "active", "completed", "failed", "delayed"] as const;
        const state = (known as readonly string[]).includes(raw)
          ? (raw as (typeof known)[number])
          : raw === "waiting-children" || raw === "prioritized"
            ? ("waiting" as const)
            : ("missing" as const);
        return { state, failedReason: job.failedReason ?? null };
      },
    }).catch((err: Error) => log(`[worker] verificador: ${err.message}`));
  const sweepTimer =
    sweepMs > 0 ? setInterval(() => void safely("verificador", sweep, log), sweepMs) : null;

  const ttlSeconds = Math.max(5, Math.ceil(((opts.heartbeatMs ?? 10_000) * 3) / 1000));
  const beat = async () => {
    await connection.set(heartbeatKey(prefix), nowUtc(), "EX", ttlSeconds);
  };
  await beat();
  const timer = setInterval(() => void safely("batimento", beat, log), opts.heartbeatMs ?? 10_000);

  return {
    queues,
    workers,
    heartbeat: () => connection.get(heartbeatKey(prefix)),
    close: async () => {
      clearInterval(timer);
      if (sweepTimer) clearInterval(sweepTimer);
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all(queueEvents.map((q) => q.close()));
      await eventsConnection.quit();
      await Promise.all(Object.values(queues).map((q) => q.close()));
      await connection.quit();
      db.close();
    },
  };
}
