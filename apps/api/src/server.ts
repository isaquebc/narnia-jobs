import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import {
  createRepos,
  DEFAULT_JOB_OPTIONS,
  migrate,
  openDatabase,
  type StageJobData,
} from "@narnia-jobs/core";
import { createProviderFromEnv } from "@narnia-jobs/providers";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { createApp } from "./app";
import { generateBootToken } from "./auth";
import { EventBus } from "./events";
import { BullQueueAdapter } from "./queue";
import { startRedisRelay } from "./relay";
import { attachWebSocket } from "./ws";

const port = Number(process.env.PORT ?? 3100);
const dataDir = process.env.NARNIA_DATA_DIR ?? "/data";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const prefix = process.env.NARNIA_QUEUE_PREFIX ?? "narnia";
const token = process.env.NARNIA_TOKEN || generateBootToken();
const publicBase = process.env.NARNIA_PUBLIC_URL ?? `http://127.0.0.1:${port}`;

mkdirSync(dataDir, { recursive: true });
const db = openDatabase(join(dataDir, "narnia.sqlite"));
migrate(db);
const repos = createRepos(db);
const provider = createProviderFromEnv();
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const queueOpts = { connection, prefix, defaultJobOptions: { ...DEFAULT_JOB_OPTIONS } };
const queues = {
  ingest: new Queue<StageJobData>("ingest", queueOpts),
  ocr: new Queue<StageJobData>("ocr", queueOpts),
  extract: new Queue<StageJobData>("extract", queueOpts),
};
const bus = new EventBus();
const relay = startRedisRelay({ redisUrl, prefix, bus });

const app = createApp({
  version: process.env.NARNIA_VERSION ?? "0.0.0",
  repos,
  dataDir,
  provider,
  queue: new BullQueueAdapter(queues, repos),
  bus,
  token,
});

const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(
    `[api] ouvindo em http://${info.address}:${info.port} · provider: ${provider.id} · dados: ${dataDir}`,
  );
  console.log(`[api] abra: ${publicBase}/api/auth/enter?token=${token}`);
});
attachWebSocket({ server: server as unknown as import("node:http").Server, bus, token });

const shutdown = async () => {
  console.log("[api] encerrando…");
  await relay.close();
  await Promise.all(Object.values(queues).map((q) => q.close()));
  await connection.quit();
  db.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
