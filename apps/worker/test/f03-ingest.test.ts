import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  confirmRun,
  createGhClient,
  createRepos,
  decideRun,
  type FakeGhState,
  fakeGh,
  INGEST_TASKS,
  LOGIN,
  migrate,
  openDatabase,
  prepareTask,
  type Repos,
  type StageName,
  type TaskJobData,
  type TaskRequest,
  withSnapshots,
} from "@narnia-jobs/core";
import { MockProvider } from "@narnia-jobs/providers";
import type { Budget, WsEvent } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { processStage, type WorkerDeps } from "../src/pipeline";
import { processTask } from "../src/tasks";

const REPOS = [
  "ana-exemplo/api-pagamentos",
  "ana-exemplo/painel-web",
  "ana-exemplo/notas-privadas",
];

function harness(o: { provider?: MockProvider; state?: FakeGhState } = {}) {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos: Repos = createRepos(db);
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-worker-f03-"));
  const provider = o.provider ?? new MockProvider();
  const state: FakeGhState = o.state ?? { authenticated: true };
  const queue: TaskRequest[] = [];
  const stages: Array<{ runId: string; stage: StageName }> = [];
  const events: WsEvent[] = [];
  const deps: WorkerDeps = {
    repos,
    dataDir,
    provider,
    ocr: {
      render: async () => [],
      createRecognizer: async () => ({
        recognize: async () => ({ text: "", confidence: 0 }),
        terminate: async () => {},
      }),
    },
    enqueue: async (runId, stage) => {
      stages.push({ runId, stage });
    },
    enqueueTask: async (req) => {
      queue.push(req);
    },
    publish: async (e) => {
      events.push(e);
    },
    // como em produção (resolveGhRuntime com snapshots): o que foi lido responde sem rede
    gh: () => withSnapshots(createGhClient({ exec: fakeGh({ state }).exec }), { dataDir, repos }),
  };
  /** Roda as tarefas enfileiradas até a fila esvaziar (simula a BullMQ), devolvendo os tipos processados. */
  const drain = async (max = 50): Promise<string[]> => {
    const done: string[] = [];
    while (queue.length > 0 && done.length < max) {
      const req = queue.shift() as TaskRequest;
      const data: TaskJobData = {
        kind: "task",
        type: req.type,
        key: req.key,
        payload: req.payload,
      };
      await processTask(
        data,
        { jobId: `task__${req.type}__${req.key}`, progress: async () => {} },
        deps,
      );
      done.push(req.type);
    }
    return done;
  };
  const createRun = (names = REPOS, amount = 50_000) => {
    const budget: Budget = {
      amount,
      unit: "thousand",
      depth: "quick",
      perRepo: Math.floor(amount / names.length),
      reserve: { synthesis: 0, check: 0 },
    };
    const run = repos.ingestionRuns.createGithub({
      provider: "mock",
      mode: "private",
      depth: "quick",
      model: "haiku",
      params: { repos: names },
      budget,
    });
    queue.push(prepareTask(run.id));
    return run;
  };
  return {
    repos,
    dataDir,
    deps,
    state,
    queue,
    stages,
    events,
    drain,
    createRun,
    provider,
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}

const statusEvents = (events: WsEvent[]) =>
  events.filter((e) => e.type === "ingestion.updated").map((e) => (e as { status: string }).status);
const notificationKinds = (events: WsEvent[]) =>
  events
    .filter((e) => e.type === "notification.created")
    .map((e) => (e as { notification: { kind: string } }).notification.kind);

describe("F03/M3 worker · execução do GitHub ponta a ponta (tarefas)", () => {
  let h: ReturnType<typeof harness>;
  afterEach(() => h?.cleanup());

  it("prepare coleta repositórios e métricas sem tokens, divide o orçamento e espera confirmação", async () => {
    h = harness();
    const run = h.createRun();
    await h.drain();
    const r = h.repos.ingestionRuns.get(run.id);
    expect(r?.status).toBe("awaiting_confirmation");
    expect(r?.params.login).toBe(LOGIN);
    expect(String(r?.params.metricsTable)).toMatch(/commits/);
    expect(r?.report?.repos.map((x) => x.status)).toEqual(["pending", "pending", "pending"]);
    expect(r?.report?.repos[0]?.estimatedTokens).toBeGreaterThan(0);
    expect(r?.budget?.perRepo).toBeGreaterThan(0);
    expect(r?.budget?.reserve.synthesis).toBeGreaterThan(0);
    expect(
      h.repos.repos
        .list()
        .map((x) => x.fullName)
        .sort(),
    ).toEqual([...REPOS].sort());
    expect(h.repos.githubMetrics.get({ scope: "global" })?.commits).toBeGreaterThan(0);
    expect(h.repos.usageEvents.list?.() ?? []).toHaveLength(0);
    expect(statusEvents(h.events)).toContain("awaiting_confirmation");
  });

  it("confirmar roda um repositório por tarefa, síntese, reconciliação e conferência até a revisão", async () => {
    h = harness();
    const run = h.createRun();
    await h.drain();
    h.queue.push(...confirmRun(h.repos, run.id));
    const done = await h.drain();
    expect(done.filter((t) => t === INGEST_TASKS.githubRepo)).toHaveLength(3);
    expect(done.slice(-3)).toEqual([
      INGEST_TASKS.githubSynthesis,
      INGEST_TASKS.reconcile,
      INGEST_TASKS.reviewCheck,
    ]);
    const r = h.repos.ingestionRuns.get(run.id);
    expect(r?.status).toBe("review");
    expect(r?.report?.repos.every((x) => x.status === "done")).toBe(true);
    expect(r?.report?.synthesis).toMatch(/3 repositórios/);
    expect(r?.report?.finishedAt).not.toBeNull();
    const repo = h.repos.repos.getByFullName("ana-exemplo/api-pagamentos");
    expect(h.repos.repoAnalyses.latestDone(repo?.id ?? "")?.kind).toBe("full");
    expect(h.repos.repoDigests.get(repo?.id ?? "")?.summary).toMatch(/api-pagamentos/);
    const proposals = h.repos.proposals.listByRun(run.id);
    expect(proposals.some((p) => p.kind === "project")).toBe(true);
    expect(proposals.every((p) => p.evidence !== null)).toBe(true);
    expect(proposals.every((p) => p.checkStatus !== "unchecked")).toBe(true);
    expect(proposals.some((p) => p.checkStatus === "supported")).toBe(true);
    const cats = (h.repos.usageEvents.list?.() ?? []).map((u) => u.category);
    expect(cats).toEqual(expect.arrayContaining(["ingest.github.repo", "ingest.github.synthesis"]));
    expect(notificationKinds(h.events)).toContain("review.pending");
    expect(h.repos.notifications.countUnresolved()).toBeGreaterThan(0);
  });

  it("freio: orçamento estourado pausa antes do próximo repositório e espera decisão; continuar termina", async () => {
    h = harness();
    const run = h.createRun(REPOS, 50);
    await h.drain();
    h.queue.push(...confirmRun(h.repos, run.id));
    await h.drain();
    let r = h.repos.ingestionRuns.get(run.id);
    expect(r?.status).toBe("awaiting_decision");
    expect(r?.report?.stops.length).toBeGreaterThan(0);
    const pending = r?.report?.repos.filter((x) => x.status === "pending").length ?? 0;
    expect(pending).toBeGreaterThan(0);
    expect(notificationKinds(h.events)).toContain("ingestion.awaiting_decision");
    const d = decideRun(h.repos, run.id, { action: "continue", extraBudget: 1_000_000 });
    h.queue.push(...d.tasks);
    await h.drain();
    r = h.repos.ingestionRuns.get(run.id);
    expect(r?.status).toBe("review");
    expect(r?.report?.repos.every((x) => x.status === "done")).toBe(true);
    expect(h.repos.notifications.list({ status: "open" }).map((n) => n.kind)).not.toContain(
      "ingestion.awaiting_decision",
    );
  });

  it("encerrar com o feito: pendentes ficam como pulados por orçamento e a síntese roda sobre o que existe", async () => {
    h = harness();
    const run = h.createRun(REPOS, 50);
    await h.drain();
    h.queue.push(...confirmRun(h.repos, run.id));
    await h.drain();
    h.queue.push(...decideRun(h.repos, run.id, { action: "finish" }).tasks);
    await h.drain();
    const r = h.repos.ingestionRuns.get(run.id);
    expect(r?.status).toBe("review");
    expect(r?.report?.skipped.length).toBeGreaterThan(0);
  });

  it("erro num repositório não derruba os outros", async () => {
    h = harness();
    const run = h.createRun(["ana-exemplo/api-pagamentos", "ana-exemplo/nao-existe"]);
    await h.drain();
    h.queue.push(...confirmRun(h.repos, run.id));
    await h.drain();
    const r = h.repos.ingestionRuns.get(run.id);
    expect(r?.report?.repos.find((x) => x.fullName === "ana-exemplo/nao-existe")?.status).toBe(
      "error",
    );
    expect(r?.report?.repos.find((x) => x.fullName === "ana-exemplo/api-pagamentos")?.status).toBe(
      "done",
    );
    expect(r?.status).toBe("review");
  });

  it("cancelada: tarefas na fila não chamam o modelo", async () => {
    h = harness();
    const run = h.createRun();
    await h.drain();
    const tasks = confirmRun(h.repos, run.id);
    h.repos.ingestionRuns.setStatus(run.id, "cancelled");
    h.queue.push(...tasks);
    await h.drain();
    expect(h.repos.proposals.listByRun(run.id)).toHaveLength(0);
    expect(h.repos.ingestionRuns.get(run.id)?.status).toBe("cancelled");
  });

  it("incremental: commit novo usa o relatório anterior e o diff; sem mudança, segunda rodada cobre o restante", async () => {
    h = harness();
    const one = ["ana-exemplo/api-pagamentos"];
    const first = h.createRun(one);
    await h.drain();
    h.queue.push(...confirmRun(h.repos, first.id));
    await h.drain();
    h.state.heads = { "ana-exemplo/api-pagamentos": "b".repeat(40) };
    const second = h.createRun(one);
    await h.drain();
    h.queue.push(...confirmRun(h.repos, second.id));
    await h.drain();
    const repoId = h.repos.repos.getByFullName(one[0] as string)?.id ?? "";
    const inc = h.repos.repoAnalyses.latestDone(repoId);
    expect(inc?.kind).toBe("incremental");
    expect(inc?.baseSha).toBe("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0");
    expect(inc?.parentId).not.toBeNull();
    const third = h.createRun(one);
    h.repos.ingestionRuns.setParams(third.id, { ...third.params, kind: "cover" });
    await h.drain();
    h.queue.push(...confirmRun(h.repos, third.id));
    await h.drain();
    const cover = h.repos.repoAnalyses.latestDone(repoId);
    expect(cover?.kind).toBe("cover");
    expect(cover?.coverage.files.length).toBeGreaterThanOrEqual(inc?.coverage.files.length ?? 0);
  });

  it("sem rede: re-rodar o mesmo repositório responde pelo snapshot e chega à revisão (F03-9, E2E-11)", async () => {
    h = harness();
    const one = ["ana-exemplo/api-pagamentos"];
    const first = h.createRun(one);
    await h.drain();
    h.queue.push(...confirmRun(h.repos, first.id));
    await h.drain();
    expect(h.repos.snapshots.list().some((x) => x.ref === one[0])).toBe(true);
    h.state.offline = true;
    const second = h.createRun(one);
    h.repos.ingestionRuns.setParams(second.id, { ...second.params, kind: "deepen" });
    await h.drain();
    expect(h.repos.ingestionRuns.get(second.id)?.status).toBe("awaiting_confirmation");
    h.queue.push(...confirmRun(h.repos, second.id));
    await h.drain();
    expect(h.repos.ingestionRuns.get(second.id)?.status).toBe("review");
    expect(h.repos.snapshots.list().find((x) => x.ref === one[0])?.lastUsedAt).not.toBeNull();
  });

  it("revisão anti-alucinação: trecho inventado vira `unsupported`; camada 2 desligável", async () => {
    const provider = new MockProvider();
    provider.setMode({ unsupportedEvidence: true });
    h = harness({ provider });
    h.repos.settings.set("ingest.review_check_model_enabled", false);
    const run = h.createRun(["ana-exemplo/api-pagamentos"]);
    await h.drain();
    h.queue.push(...confirmRun(h.repos, run.id));
    await h.drain();
    const ps = h.repos.proposals.listByRun(run.id);
    expect(ps.some((p) => p.checkStatus === "unsupported")).toBe(true);
    expect(ps.some((p) => p.checkStatus === "unchecked")).toBe(true);
    expect((h.repos.usageEvents.list?.() ?? []).map((u) => u.category)).not.toContain(
      "ingest.review_check",
    );
  });

  it("pública sem login: prepara e analisa sem as métricas (GraphQL exige login)", async () => {
    h = harness({ state: { authenticated: false } });
    const r = h.createRun(["ana-exemplo/api-pagamentos"]);
    h.repos.db.prepare("update ingestion_run set mode = 'public' where id = ?").run(r.id);
    h.repos.ingestionRuns.setParams(r.id, { ...r.params, login: "ana-exemplo" });
    await h.drain();
    expect(h.repos.ingestionRuns.get(r.id)?.status).toBe("awaiting_confirmation");
    h.queue.push(...confirmRun(h.repos, r.id));
    await h.drain();
    expect(h.repos.ingestionRuns.get(r.id)?.status).toBe("review");
    expect(h.repos.githubMetrics.list()).toEqual([]);
  });

  it("privada sem login: a preparação falha com mensagem e notificação de erro", async () => {
    h = harness({ state: { authenticated: false } });
    const run = h.createRun();
    await h.drain();
    const r = h.repos.ingestionRuns.get(run.id);
    expect(r?.status).toBe("error");
    expect(r?.error).toMatch(/GitHub/);
    expect(notificationKinds(h.events)).toContain("ingestion.error");
  });
});

describe("F03/M3 worker · cadeia do F01 com evidência, reconciliação e conferência", () => {
  let h: ReturnType<typeof harness>;
  afterEach(() => h?.cleanup());

  it("CV: fatos com evidência, reconcile marca existentes, conferência e revisão notificada", async () => {
    h = harness();
    const { MOCK_CV_TEXT } = await import("@narnia-jobs/providers");
    mkdirSync(join(h.dataDir, "uploads"), { recursive: true });
    writeFileSync(join(h.dataDir, "uploads", "cv.txt"), MOCK_CV_TEXT);
    const file = h.repos.sourceFiles.insert({
      originalName: "cv.txt",
      mime: "text/plain",
      size: MOCK_CV_TEXT.length,
      sha256: "sha-cv",
      path: "uploads/cv.txt",
      kind: "cv",
    });
    const run = h.repos.ingestionRuns.create({
      fileId: file.id,
      provider: "mock",
      models: { document: "haiku", facts: "haiku", digest: "sonnet" },
      options: { ocr: false, modelRead: false },
    });
    h.repos.facts.skills.insert({
      name: "Go",
      category: "language",
      confidence: 1,
      verified: true,
    });
    const ctx = { runId: run.id, jobId: "j", progress: async () => {} };
    let stage: StageName | undefined = "ingest.read_text";
    while (stage) {
      await processStage({ runId: run.id, stage }, ctx, h.deps);
      const next = h.stages.shift();
      stage = next?.stage;
    }
    const ps = h.repos.proposals.listByRun(run.id);
    expect(ps.filter((p) => p.evidence).length).toBeGreaterThan(5);
    expect(
      ps.find((p) => p.kind === "skill" && (p.proposal.data as { name: string }).name === "Go")
        ?.match,
    ).toBe("existing");
    expect(ps.some((p) => p.checkStatus === "supported")).toBe(true);
    expect(h.repos.ingestionRuns.get(run.id)?.status).toBe("review");
    expect(notificationKinds(h.events)).toContain("review.pending");
  });
});
