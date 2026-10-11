import { join } from "node:path";
import { createProviderFromEnv } from "@narnia-jobs/providers";
import { drainThenClose, WORKER_DRAIN_MS_DEFAULT } from "./shutdown";
import { startWorkers } from "./worker";

const dataDir = process.env.NARNIA_DATA_DIR ?? "/data";
const started = await startWorkers({
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  prefix: process.env.NARNIA_QUEUE_PREFIX ?? "narnia",
  dbPath: join(dataDir, "narnia.sqlite"),
  dataDir,
  provider: createProviderFromEnv(),
  log: (line) => console.log(line),
});
console.log(
  `[worker] filas: ${Object.keys(started.queues).join(", ")} · provider: ${process.env.NARNIA_PROVIDER ?? "claude-code"} · dados: ${dataDir}`,
);

const drainMs = Number(process.env.NARNIA_WORKER_DRAIN_MS ?? WORKER_DRAIN_MS_DEFAULT);
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] encerrando… (espera o job ativo até ${drainMs} ms)`);
  await drainThenClose({
    close: () => started.close(),
    timeoutMs: Number.isFinite(drainMs) ? drainMs : WORKER_DRAIN_MS_DEFAULT,
    log: (l) => console.log(l),
  });
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
