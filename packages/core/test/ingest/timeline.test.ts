import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { enqueueStage } from "../../src/ingest/chain";
import {
  prepareTask,
  reconcileTask,
  repoTask,
  reviewCheckTask,
  synthesisTask,
  type TaskRequest,
} from "../../src/ingest/github-run";
import { runJobs } from "../../src/ingest/heal";
import { markRepo, newRunReport } from "../../src/ingest/report";
import { buildTimeline } from "../../src/ingest/timeline";
import { enqueueTask } from "../../src/jobs/tasks";

/** Plano de comunicação C1 (2026-10-11): etapas reais da execução, sem tabela nova; jobs pelo caminho de produção. */
const BUDGET = {
  amount: 50_000,
  unit: "thousand" as const,
  depth: "balanced" as const,
  perRepo: 4_000,
  reserve: { synthesis: 6_000, check: 2_000 },
};
const q = { add: async () => {} };
const queues = { ingest: q, ocr: q, extract: q };
const T = (s: number) => new Date(Date.UTC(2026, 9, 11, 10, 0, s)).toISOString();

function github() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  const run = repos.ingestionRuns.createGithub({
    provider: "mock",
    mode: "private",
    depth: "balanced",
    model: "haiku",
    params: { repos: ["ana/a", "ana/b", "ana/vazio"] },
    budget: BUDGET,
  });
  const id = run.id;
  const task = async (
    req: TaskRequest,
    ev: "active" | "completed" | "failed" | null,
    at: string,
    error?: string,
  ) => {
    const { job } = await enqueueTask({ queues, repos, ...req, at });
    if (ev === "active" || ev === "completed" || ev === "failed")
      repos.jobs.applyEvent({ jobId: job.id, type: "active", at });
    if (ev === "completed") repos.jobs.applyEvent({ jobId: job.id, type: "completed", at });
    if (ev === "failed")
      repos.jobs.applyEvent({ jobId: job.id, type: "failed", at, ...(error ? { error } : {}) });
    return job.id;
  };
  const report = (fn: (r: ReturnType<typeof newRunReport>) => ReturnType<typeof newRunReport>) => {
    const base =
      repos.ingestionRuns.get(id)?.report ??
      newRunReport({
        model: "haiku",
        budget: 50_000,
        startedAt: T(0),
        repos: ["ana/a", "ana/b", "ana/vazio"].map((fullName) => ({
          fullName,
          estimatedTokens: 1000,
        })),
      });
    repos.ingestionRuns.setReport(id, fn(base));
  };
  const tl = (now = new Date(T(60))) => {
    const r = repos.ingestionRuns.get(id);
    if (!r) throw new Error("run");
    return buildTimeline({ run: r, jobs: runJobs(repos, id), now });
  };
  return { repos, id, task, report, tl };
}

describe("buildTimeline · GitHub", () => {
  it("analisando repositórios: preparar concluída, 'x de y' conta analisados, vazios e falhos; etapa 2 de 6", async () => {
    const g = github();
    await g.task(prepareTask(g.id), "completed", T(1));
    g.report((r) => r);
    g.repos.ingestionRuns.setStatus(g.id, "running");
    await g.task(repoTask(g.id, "ana/a"), "completed", T(10));
    await g.task(repoTask(g.id, "ana/b"), "active", T(20));
    g.report((r) =>
      markRepo(markRepo(r, "ana/a", { status: "done", usedTokens: 900 }), "ana/vazio", {
        status: "skipped_empty",
        usedTokens: 0,
        stoppedReason: "repositório vazio (sem commits)",
      }),
    );
    const t = g.tl(new Date(T(30)));
    expect(t.steps.map((s) => s.key)).toEqual([
      "prepare",
      "repos",
      "synthesis",
      "reconcile",
      "review_check",
      "review",
    ]);
    expect(t.steps.map((s) => s.state)).toEqual([
      "done",
      "running",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(t.steps[1]?.progress).toEqual({ done: 2, total: 3 });
    expect(t.current).toBe(2);
    expect(t.total).toBe(6);
  });

  it("conferindo propostas: etapa 5 de 6 com duração das concluídas", async () => {
    const g = github();
    await g.task(prepareTask(g.id), "completed", T(1));
    g.repos.ingestionRuns.setStatus(g.id, "running");
    for (const r of ["ana/a", "ana/b"]) await g.task(repoTask(g.id, r), "completed", T(10));
    g.report((r) =>
      markRepo(
        markRepo(markRepo(r, "ana/a", { status: "done", usedTokens: 1 }), "ana/b", {
          status: "error",
          usedTokens: 0,
          stoppedReason: "Reached maximum number of turns (1)",
        }),
        "ana/vazio",
        { status: "skipped_empty", usedTokens: 0 },
      ),
    );
    await g.task(synthesisTask(g.id), "completed", T(20));
    await g.task(reconcileTask(g.id), "completed", T(21));
    await g.task(reviewCheckTask(g.id), "active", T(22));
    const t = g.tl(new Date(T(40)));
    expect(t.current).toBe(5);
    expect(t.steps[4]?.state).toBe("running");
    expect(t.steps[1]?.progress).toEqual({ done: 3, total: 3 });
    expect(t.steps[1]?.failures).toBe(1);
    expect(t.steps[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("etapa ativa sem sinal há mais de 2 min fica 'stuck'", async () => {
    const g = github();
    await g.task(prepareTask(g.id), "completed", T(1));
    g.repos.ingestionRuns.setStatus(g.id, "running");
    for (const r of ["ana/a", "ana/b", "ana/vazio"])
      await g.task(repoTask(g.id, r), "completed", T(2));
    await g.task(synthesisTask(g.id), "active", T(5));
    const t = g.tl(new Date(Date.parse(T(5)) + 121_000));
    expect(t.steps[2]?.state).toBe("stuck");
    expect(t.stuck).toBe(true);
  });

  it("execução em erro: a etapa da tarefa que falhou fica em erro com mensagem amigável", async () => {
    const g = github();
    await g.task(prepareTask(g.id), "completed", T(1));
    for (const r of ["ana/a", "ana/b", "ana/vazio"])
      await g.task(repoTask(g.id, r), "completed", T(2));
    await g.task(synthesisTask(g.id), "failed", T(5), "job stalled more than allowable limit");
    g.repos.ingestionRuns.setStatus(g.id, "error", {
      error: "job stalled more than allowable limit",
    });
    const t = g.tl();
    expect(t.steps[2]?.state).toBe("error");
    expect(t.steps[2]?.error?.key).toBe("error.interrupted");
  });

  it("pronta para revisão: tudo concluído e a revisão em andamento (aguardando o usuário)", async () => {
    const g = github();
    await g.task(prepareTask(g.id), "completed", T(1));
    for (const r of ["ana/a", "ana/b", "ana/vazio"])
      await g.task(repoTask(g.id, r), "completed", T(2));
    for (const t of [synthesisTask(g.id), reconcileTask(g.id), reviewCheckTask(g.id)])
      await g.task(t, "completed", T(3));
    g.repos.ingestionRuns.setStatus(g.id, "review");
    const t = g.tl();
    expect(t.steps.at(-1)?.state).toBe("running");
    expect(t.current).toBe(6);
  });
});

describe("buildTimeline · CV e texto", () => {
  function cv(isPdf: boolean, ocr: boolean) {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const file = repos.sourceFiles.insert({
      originalName: isPdf ? "cv.pdf" : "cv.md",
      mime: isPdf ? "application/pdf" : "text/markdown",
      size: 10,
      sha256: "b".repeat(64),
      path: "uploads/x",
      kind: "cv",
    });
    const run = repos.ingestionRuns.create({
      fileId: file.id,
      provider: "mock",
      models: { document: "h", facts: "h", digest: "s" },
      options: { ocr, modelRead: false },
    });
    return { repos, run, isPdf };
  }

  it("PDF com OCR: etapas planejadas na ordem e a atual pela primeira não terminada", async () => {
    const c = cv(true, true);
    const job = await enqueueStage({
      queues,
      repos: c.repos,
      runId: c.run.id,
      stage: "ingest.read_text",
    });
    c.repos.jobs.applyEvent({ jobId: job.id, type: "completed", at: T(1) });
    const ocr = await enqueueStage({ queues, repos: c.repos, runId: c.run.id, stage: "ocr.pages" });
    c.repos.jobs.applyEvent({ jobId: ocr.id, type: "active", at: T(2) });
    c.repos.ingestionRuns.setStatus(c.run.id, "running");
    const r = c.repos.ingestionRuns.get(c.run.id);
    if (!r) throw new Error("run");
    const t = buildTimeline({
      run: r,
      jobs: runJobs(c.repos, c.run.id),
      isPdf: true,
      now: new Date(T(10)),
    });
    expect(t.steps.map((s) => s.key)).toEqual([
      "ingest.read_text",
      "ocr.pages",
      "ingest.consolidate",
      "extract.facts",
      "extract.digest",
      "ingest.reconcile",
      "ingest.review_check",
      "review",
    ]);
    expect(t.current).toBe(2);
  });

  it("texto (não PDF) não tem OCR nem leitura pelo modelo", () => {
    const c = cv(false, true);
    const r = c.repos.ingestionRuns.get(c.run.id);
    if (!r) throw new Error("run");
    const t = buildTimeline({ run: r, jobs: [], isPdf: false, now: new Date(T(10)) });
    expect(t.steps.map((s) => s.key)).not.toContain("ocr.pages");
    expect(t.steps.map((s) => s.key)).not.toContain("extract.read_doc");
  });
});
