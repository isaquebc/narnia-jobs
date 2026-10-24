import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import {
  assembleCv,
  buildCvBrief,
  buildCvHeader,
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
import { MockProvider, type Provider } from "@narnia-jobs/providers";
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
  /** F12/M5: formulário de candidatura novo, ligado à vaga do sandbox (um por caso: a conversa é por formulário). */
  newApplication(): string;
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
  const seeded = seedFixture(repos, o.fixture ?? "engineer");
  await seedPostingCv(repos, seeded.profileId);
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
    newApplication: () => seedApplicationForm(repos, seeded.profileId),
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

/**
 * Vaga com um CV pronto (casos `open: document_feedback`): o rascunho é o do mock, determinístico, mesmo quando a
 * rodada usa o modelo real (o preparo não gasta tokens; o que se avalia é a conversa de feedback).
 */
/**
 * Formulário fictício da vaga do sandbox (F12/M5), como a extensão deixa depois de organizar e responder: a motivação
 * com limite e a resposta do roleplay, o modelo de trabalho (escolha) e o consentimento (fica com a pessoa).
 */
function seedApplicationForm(repos: Repos, profileId: string): string {
  const posting = repos.postings.list().find((p) => p.company === "Globex Consultoria");
  const f = repos.applications.create({
    captureId: `avaliacao-${randomBytes(4).toString("hex")}`,
    postingId: posting?.id ?? null,
    profileId,
    url: "https://vagas.example/globex/backend/aplicar",
    title: "Candidatura · Globex Consultoria",
    fields: [],
  });
  const base = {
    options: [] as Array<{ value: string; label: string }>,
    required: true,
    maxChars: null as number | null,
    section: null,
    profileField: null,
    topic: null,
    source: "model" as const,
  };
  repos.applications.setQuestions(f.id, [
    {
      ...base,
      id: "motivo",
      question: "Por que você quer trabalhar na Globex?",
      kind: "long_text",
      maxChars: 500,
      fieldRefs: ["f1"],
    },
    {
      ...base,
      id: "modelo",
      question: "Modelo de trabalho preferido",
      kind: "choice",
      options: [
        { value: "remoto", label: "Remoto" },
        { value: "hibrido", label: "Híbrido" },
        { value: "presencial", label: "Presencial" },
      ],
      fieldRefs: ["f2"],
    },
    {
      ...base,
      id: "lgpd",
      question: "Concordo com a política de privacidade",
      kind: "consent",
      fieldRefs: ["f3"],
    },
  ]);
  repos.applications.addAnswers(f.id, [
    {
      questionId: "motivo",
      answer:
        "Trabalho com pagamentos há alguns anos e quero levar essa experiência para os projetos da Globex com bancos.",
      origins: [],
      gap: null,
      assumptions: ["Que você quer continuar em pagamentos."],
      source: "roleplay",
    },
  ]);
  return f.id;
}

async function seedPostingCv(repos: Repos, profileId: string) {
  const posting = repos.postings.create({
    company: "Globex Consultoria",
    role: "backend",
    title: "Desenvolvedora Backend Sênior",
    jdText:
      "Desenvolvedora Backend Sênior. Requisitos: Node.js, TypeScript, PostgreSQL e Kubernetes. Diferenciais: AWS e Kafka.",
  });
  const doc = repos.documents.create({
    kind: "cv",
    profileId,
    postingId: posting.id,
    templateId: "classico",
    paper: "A4",
    locale: "pt-BR",
    format: "pdf",
  });
  const version = repos.documents.addVersion(doc.id, {
    source: "agent",
    instructions: null,
    factsVersion: repos.settings.getFactsVersion(),
    postingUpdatedAt: posting.contentUpdatedAt,
    profileHash: "avaliacao",
  });
  const { brief } = buildCvBrief(repos, {
    kind: "cv",
    profileId,
    postingId: posting.id,
    locale: "pt-BR",
    instructions: null,
    previousIssues: [],
  });
  const draft = (await new MockProvider().cvGenerate({ brief, model: "mock" })).output;
  const { content } = assembleCv(repos, brief, draft, {
    meta: {
      locale: "pt-BR",
      paper: "A4",
      profileId,
      postingId: posting.id,
      generatedAt: new Date().toISOString(),
    },
    header: buildCvHeader(repos, profileId, "pt-BR"),
  });
  repos.documents.updateVersion(version.id, { status: "ready", content });
}
