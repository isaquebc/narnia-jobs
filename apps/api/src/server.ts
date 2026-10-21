import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import {
  createRepos,
  DEFAULT_JOB_OPTIONS,
  initTelemetry,
  migrate,
  openDatabase,
  resolveBackupDir,
  type StageJobData,
  shutdownTelemetry,
} from "@narnia-jobs/core";
import { createProviderFromEnv } from "@narnia-jobs/providers";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { createApp } from "./app";
import { generateBootToken } from "./auth";
import { bootData } from "./boot";
import { SessionManager } from "./chat/session-manager";
import { syncApproved } from "./evals/approved-sync";
import { syncEvaluators } from "./evals/eval-sync";
import { bridgeUrlForPhoenix, createPhoenixAdmin, phoenixBaseUrl } from "./evals/phoenix-admin";
import { gitCommit, setupPhoenix } from "./evals/phoenix-setup";
import { promptCatalog } from "./evals/prompt-catalog";
import { syncPrompts } from "./evals/prompt-sync";
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
const backupDir = resolveBackupDir(process.env, dataDir);
const db = openDatabase(join(dataDir, "narnia.sqlite"));
migrate(db, { backupDir });
const repos = createRepos(db);
// F03-fix L1: backup do dia fora da pasta de dados e aviso de banco recriado; nunca impede o boot
bootData({ db, repos, dataDir, backupDir });
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

// sessões de chat no processo do api (F04-10): o CLI chama o /mcp deste api pela rede interna do container
const sessions = new SessionManager({
  repos,
  provider,
  bus,
  token,
  mcpUrl: `http://127.0.0.1:${port}/mcp`,
});
const hibernated = sessions.hibernateAllOnBoot();
if (hibernated > 0)
  console.log(`[api] ${hibernated} conversa(s) hibernada(s) no boot (retomam com resume)`);
sessions.startSweep();

const app = createApp({
  version: process.env.NARNIA_VERSION ?? "0.0.0",
  repos,
  dataDir,
  provider,
  queue: new BullQueueAdapter(queues, repos),
  bus,
  token,
  backupDir,
  sessions,
});

const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(
    `[api] ouvindo em http://${info.address}:${info.port} · provider: ${provider.id} · dados: ${dataDir}`,
  );
  console.log(`[api] abra: ${publicBase}/api/auth/enter?token=${token}`);
});
attachWebSocket({ server: server as unknown as import("node:http").Server, bus, token });

// F04/M5: rastros para o Phoenix local só com NARNIA_OTEL_ENDPOINT (ligado por padrão no compose de dev)
if (await initTelemetry(process.env, "narnia-api"))
  console.log(`[api] rastros OpenTelemetry → ${process.env.NARNIA_OTEL_ENDPOINT}`);

// avaliações (M2): com o Phoenix no ar, registra a ponte da assinatura e sincroniza os prompts do repositório
{
  const phoenixUrl = phoenixBaseUrl(process.env);
  if (phoenixUrl) {
    const admin = createPhoenixAdmin({ baseUrl: phoenixUrl });
    void setupPhoenix({
      repos,
      admin,
      bridgeUrl: bridgeUrlForPhoenix(process.env),
      sync: async (customProviderId) => ({
        prompts: await syncPrompts(promptCatalog(), {
          baseUrl: phoenixUrl,
          customProviderId,
          commit: gitCommit(),
        }),
        evaluators: await syncEvaluators({ baseUrl: phoenixUrl, customProviderId }),
        // versões aprovadas do git (AV-6) depois dos datasets, que elas usam
        approved: await syncApproved({ baseUrl: phoenixUrl }),
      }),
    })
      .then((r) => {
        if (r.registered) console.log("[api] ponte da assinatura registrada no Phoenix");
        if (r.synced > 0)
          console.log(
            `[api] Phoenix: ${r.synced} prompt(s)/avaliador(es) novos ou com versão nova`,
          );
      })
      .catch((e: unknown) =>
        console.warn(`[api] Phoenix: preparação falhou (${(e as Error).message})`),
      );
  }
}

const shutdown = async () => {
  console.log("[api] encerrando…");
  sessions.closeAll();
  await relay.close();
  await Promise.all(Object.values(queues).map((q) => q.close()));
  await connection.quit();
  db.close();
  await shutdownTelemetry();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
