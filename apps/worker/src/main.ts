import { join } from "node:path";
import { createProviderFromEnv } from "@narnia-jobs/providers";
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

const shutdown = async () => {
  console.log("[worker] encerrando…");
  await started.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
