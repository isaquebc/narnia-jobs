import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import {
  createRepos,
  enqueueTask,
  type FixtureName,
  migrate,
  openDatabase,
  type Repos,
  type StageName,
  seedFixture,
  stageJobId,
} from "@narnia-jobs/core";
import type { Provider } from "@narnia-jobs/providers";
import { createApp } from "../app";
import { SessionManager } from "../chat/session-manager";
import { EventBus } from "../events";
import type { EnqueueTaskRequest, QueueAdapter } from "../queue";

/**
 * Banco temporário isolado para as avaliações que conversam com o recrutador (decisão AV-3 revista, 2026-10-13): um
 * SQLite descartável com uma fixture fictícia, uma app própria (rotas, `/mcp`, sessões de chat) servida só em
 * 127.0.0.1 numa porta livre e com token próprio. O CLI do Claude (processo filho) fala com esse `/mcp`; os dados do
 * usuário nunca entram. As ingestões criadas pela conversa ficam na fila do sandbox, sem worker (não são processadas).
 */
export interface EvalSandbox {
  baseUrl: string;
  token: string;
  dir: string;
  repos: Repos;
  close(): Promise<void>;
}

/** Fila sem worker: registra o espelho do job (a conversa vê a execução "na fila") e não processa nada. */
class SandboxQueue implements QueueAdapter {
  constructor(private readonly repos: Repos) {}
  async enqueue(runId: string, stage: StageName) {
    return this.repos.jobs.upsertQueued({
      id: stageJobId(runId, stage),
      queue: stage.startsWith("ocr") ? "ocr" : stage.startsWith("extract") ? "extract" : "ingest",
      type: stage,
      parentId: runId,
      profileId: null,
      payload: { runId, stage },
      stage,
      at: new Date().toISOString(),
    });
  }
  async enqueueTask(req: EnqueueTaskRequest) {
    const idle = { add: async () => {} };
    return enqueueTask({
      queues: { ingest: idle, ocr: idle, extract: idle },
      repos: this.repos,
      ...req,
    });
  }
  async cancel() {
    return "removed" as const;
  }
  async retry() {
    return false;
  }
  async state() {
    return { state: "waiting" as const };
  }
}

export async function openEvalSandbox(o: {
  provider: Provider;
  fixture?: FixtureName;
  /** Pasta onde criar o banco descartável (padrão: temporária do sistema). */
  root?: string;
}): Promise<EvalSandbox> {
  const dir = mkdtempSync(join(o.root ?? tmpdir(), "narnia-avaliacao-"));
  const db = openDatabase(join(dir, "narnia.sqlite"));
  migrate(db);
  const repos = createRepos(db);
  seedFixture(repos, o.fixture ?? "engineer");
  const token = randomBytes(24).toString("hex");
  const bus = new EventBus();
  let handler: ((req: Request) => Response | Promise<Response>) | null = null;
  const server = serve({
    fetch: (req) => (handler ? handler(req) : new Response("iniciando", { status: 503 })),
    port: 0,
    hostname: "127.0.0.1",
  });
  await new Promise<void>((resolve) => {
    if ((server as unknown as { listening?: boolean }).listening) resolve();
    else server.once("listening", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const sessions = new SessionManager({
    repos,
    provider: o.provider,
    bus,
    token,
    mcpUrl: `${baseUrl}/mcp`,
  });
  const app = createApp({
    version: "avaliacao",
    repos,
    dataDir: dir,
    provider: o.provider,
    queue: new SandboxQueue(repos),
    bus,
    token,
    sessions,
    backupDir: null,
    phoenixUrl: null,
    allowedHosts: new Set(["127.0.0.1", "localhost"]),
    log: () => undefined,
  });
  handler = (req) => app.fetch(req);
  let closed = false;
  return {
    baseUrl,
    token,
    dir,
    repos,
    async close() {
      if (closed) return;
      closed = true;
      sessions.closeAll();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
