import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRepos,
  enqueueTask,
  migrate,
  openDatabase,
  type Repos,
  type StageName,
  stageJobId,
} from "@narnia-jobs/core";
import { MOCK_DIGEST, MOCK_EXTRACT_FACTS, MockProvider } from "@narnia-jobs/providers";
import { type AnyWsEvent, extractFactsOutputToProposals } from "@narnia-jobs/shared";
import { type App, createApp } from "../src/app";
import { EventBus } from "../src/events";
import type { EnqueueTaskRequest, QueueAdapter } from "../src/queue";

export const FIXTURES = new URL("../../../packages/core/test/fixtures/", import.meta.url).pathname;
export const TOKEN = "test-token-123";

export class FakeQueueAdapter implements QueueAdapter {
  enqueued: Array<{ runId: string; stage: StageName }> = [];
  cancelled: string[] = [];
  retried: string[] = [];
  tasks: EnqueueTaskRequest[] = [];
  /** Estado que a BullMQ reportaria para cancel(): por padrão "removed". */
  cancelResult: "removed" | "active" | "missing" = "removed";
  constructor(private readonly repos: Repos) {}
  async enqueue(runId: string, stage: StageName) {
    this.enqueued.push({ runId, stage });
    const id = stageJobId(runId, stage);
    return this.repos.jobs.upsertQueued({
      id,
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
    this.tasks.push(req);
    const fake = { add: async () => {} };
    return enqueueTask({
      queues: { ingest: fake, ocr: fake, extract: fake },
      repos: this.repos,
      ...req,
    });
  }
  async cancel(jobId: string) {
    this.cancelled.push(jobId);
    return this.cancelResult;
  }
  async retry(jobId: string) {
    this.retried.push(jobId);
    return true;
  }
}

export interface TestApp {
  app: App;
  repos: Repos;
  dataDir: string;
  provider: MockProvider;
  queue: FakeQueueAdapter;
  bus: EventBus;
  events: AnyWsEvent[];
  cleanup: () => void;
  /** fetch autenticado */
  api: (path: string, init?: RequestInit) => Promise<Response>;
}

export function makeTestApp(opts: { provider?: MockProvider; token?: string } = {}): TestApp {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-api-"));
  const provider = opts.provider ?? new MockProvider();
  const queue = new FakeQueueAdapter(repos);
  const bus = new EventBus();
  const events: AnyWsEvent[] = [];
  bus.on((e) => events.push(e));
  const token = opts.token ?? TOKEN;
  const app = createApp({ version: "0.0.0-test", repos, dataDir, provider, queue, bus, token });
  const api = async (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
  return {
    app,
    repos,
    dataDir,
    provider,
    queue,
    bus,
    events,
    api,
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}

export function fixtureFile(name: string, mime = "application/pdf"): File {
  const buf = readFileSync(join(FIXTURES, name));
  return new File([buf], name, { type: mime });
}

export async function uploadFixture(t: TestApp, name = "cv_text.pdf") {
  const form = new FormData();
  form.append("file", fixtureFile(name));
  const res = await t.api("/api/files", { method: "POST", body: form });
  return { res, body: (await res.json()) as { id: string; pages: number | null } };
}

/** Simula o que o worker faria: leituras/segmentos, propostas e digest; run em review. */
export function simulateWorker(t: TestApp, runId: string) {
  const run = t.repos.ingestionRuns.get(runId);
  if (!run) throw new Error("run");
  t.repos.ingestionRuns.setStatus(runId, "running");
  t.repos.readings.insert({
    runId,
    kind: "text_layer",
    textPath: "readings/x/text_layer.txt",
    quality: 1,
    pages: { language: "pt" },
  });
  t.repos.readings.replaceSegments(runId, [
    {
      index: 0,
      sectionHint: "EXPERIÊNCIA",
      text: "Acme Ltda — Engenheira de Software Sênior",
      origin: "text_layer",
      agreement: 1,
      divergences: [],
    },
    {
      index: 1,
      sectionHint: "FORMAÇÃO",
      text: "Unicamp — Bacharelado em Ciência da Computação",
      origin: "ocr",
      agreement: 0.67,
      divergences: [],
    },
  ]);
  const proposals = extractFactsOutputToProposals(MOCK_EXTRACT_FACTS);
  t.repos.proposals.insertMany(runId, proposals);
  t.repos.digests.upsert({ fileId: run.fileId as string, ...MOCK_DIGEST, editedByUser: false });
  for (const stage of [
    "ingest.read_text",
    "ingest.consolidate",
    "extract.facts",
    "extract.digest",
  ] as StageName[]) {
    const id = stageJobId(runId, stage);
    t.repos.jobs.upsertQueued({
      id,
      queue: stage.startsWith("extract") ? "extract" : "ingest",
      type: stage,
      parentId: runId,
      profileId: null,
      payload: { runId, stage },
      stage,
      at: new Date().toISOString(),
    });
    t.repos.jobs.applyEvent({ jobId: id, type: "completed", at: new Date().toISOString() });
  }
  t.repos.ingestionRuns.setStatus(runId, "review");
  return t.repos.proposals.listByRun(runId);
}

export const VALID_USER = {
  displayName: "Ana",
  fullName: "Ana Maria Exemplo",
  email: "ana.exemplo@example.com",
  phone: { e164: "+5511987654321", country: "BR", national: "11987654321" },
  city: "Campinas",
  region: "SP",
  country: "BR",
  timezone: "America/Sao_Paulo",
  remotePref: "remote",
  relocation: { mode: "none", countries: [] },
  workAuth: [{ country: "BR", status: "citizen" }],
  links: [],
};

export const VALID_PROFILE = {
  name: "Eng. Software Sênior",
  targetTitle: "Senior Backend Engineer",
  altTitles: ["Staff Engineer"],
  seniority: "senior",
  area: "software",
  goal: "new_job",
  market: "BR",
  docLocale: "pt-BR",
  salary: { min: 15000, max: 22000, currency: "BRL", period: "monthly" },
  contractTypes: ["clt", "pj"],
  locations: [{ country: "BR", remote: "remote" }],
  availableFrom: "immediate",
  needsResearch: [],
};
