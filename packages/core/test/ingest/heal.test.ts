import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { enqueueStage } from "../../src/ingest/chain";
import { synthesisTask } from "../../src/ingest/github-run";
import {
  healStuckRun,
  isJobStale,
  type QueueStateFn,
  runJobs,
  STALE_AFTER_MS,
  syncRunJobs,
} from "../../src/ingest/heal";
import { enqueueTask } from "../../src/jobs/tasks";

/**
 * Plano de comunicação C3 (2026-10-11): o espelho em `job` pode mentir (o verificador de travados da BullMQ marca
 * `failed` sem o worker saber). A recuperação consulta o estado real da fila; jobs montados pelo caminho de produção.
 */
const BUDGET = {
  amount: 50_000,
  unit: "thousand" as const,
  depth: "balanced" as const,
  perRepo: 4_000,
  reserve: { synthesis: 6_000, check: 2_000 },
};
const fakeQueues = () => {
  const q = { add: async () => {} };
  return { ingest: q, ocr: q, extract: q };
};

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  const run = repos.ingestionRuns.createGithub({
    provider: "mock",
    mode: "private",
    depth: "balanced",
    model: "haiku",
    params: { repos: ["ana/api"] },
    budget: BUDGET,
  });
  repos.ingestionRuns.setStatus(run.id, "running");
  return { repos, runId: run.id };
}

async function activeSynthesis(
  repos: ReturnType<typeof setup>["repos"],
  runId: string,
  at: string,
) {
  const { job } = await enqueueTask({ queues: fakeQueues(), repos, ...synthesisTask(runId) });
  repos.jobs.applyEvent({ jobId: job.id, type: "active", at, stage: job.type });
  return job.id;
}

describe("heal · estado real da fila e recuperação de execução presa", () => {
  it("runJobs junta jobs de tarefa (runId em payload.payload) e de etapa (parentId)", async () => {
    const { repos, runId } = setup();
    await activeSynthesis(repos, runId, new Date().toISOString());
    await enqueueStage({ queues: fakeQueues(), repos, runId, stage: "ingest.read_text" });
    expect(
      runJobs(repos, runId)
        .map((j) => j.type)
        .sort(),
    ).toEqual(["ingest.github.synthesis", "ingest.read_text"]);
  });

  it("espelho active mas fila failed (travado além do limite): sincroniza como erro e a execução vira erro com a tarefa guardada", async () => {
    const { repos, runId } = setup();
    const jobId = await activeSynthesis(repos, runId, new Date().toISOString());
    const state: QueueStateFn = async () => ({
      state: "failed",
      failedReason: "job stalled more than allowable limit",
    });
    const r = await syncRunJobs(repos, runId, state);
    expect(r.failed.map((j) => j.id)).toEqual([jobId]);
    expect(repos.jobs.get(jobId)?.status).toBe("error");
    expect(repos.jobs.get(jobId)?.error).toMatch(/stalled/);
    expect(healStuckRun(repos, runId)).toBe(true);
    const run = repos.ingestionRuns.get(runId);
    expect(run?.status).toBe("error");
    expect((run?.params.failedTask as { type?: string } | undefined)?.type).toBe(
      "ingest.github.synthesis",
    );
  });

  it("job sumido da fila (missing) também vira erro", async () => {
    const { repos, runId } = setup();
    const jobId = await activeSynthesis(repos, runId, new Date().toISOString());
    await syncRunJobs(repos, runId, async () => ({ state: "missing" }));
    expect(repos.jobs.get(jobId)?.status).toBe("error");
  });

  it("job vivo na fila não é tocado", async () => {
    const { repos, runId } = setup();
    const jobId = await activeSynthesis(repos, runId, new Date().toISOString());
    const r = await syncRunJobs(repos, runId, async () => ({ state: "active" }));
    expect(r.failed).toEqual([]);
    expect(repos.jobs.get(jobId)?.status).toBe("active");
    expect(healStuckRun(repos, runId)).toBe(false);
  });

  it("isJobStale: ativo sem sinal há mais de 2 minutos; recente ou terminado não", async () => {
    const { repos, runId } = setup();
    const t0 = new Date("2026-10-11T10:00:00Z");
    const jobId = await activeSynthesis(repos, runId, t0.toISOString());
    const job = repos.jobs.get(jobId);
    if (!job) throw new Error("job ausente");
    expect(job.updatedAt).toBe(t0.toISOString());
    expect(STALE_AFTER_MS).toBe(120_000);
    expect(isJobStale(job, new Date(t0.getTime() + 119_000))).toBe(false);
    expect(isJobStale(job, new Date(t0.getTime() + 121_000))).toBe(true);
    repos.jobs.applyEvent({ jobId, type: "completed", at: t0.toISOString() });
    const done = repos.jobs.get(jobId);
    if (!done) throw new Error("job ausente");
    expect(isJobStale(done, new Date(t0.getTime() + 999_000))).toBe(false);
  });

  it("etapa de CV que falhou na fila: execução vira erro sem tarefa guardada (retry pela etapa)", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const file = repos.sourceFiles.insert({
      originalName: "cv.pdf",
      mime: "application/pdf",
      size: 10,
      sha256: "a".repeat(64),
      path: "uploads/x.pdf",
      kind: "cv",
    });
    const run = repos.ingestionRuns.create({
      fileId: file.id,
      provider: "mock",
      models: { document: "h", facts: "h", digest: "s" },
      options: { ocr: false, modelRead: false },
    });
    repos.ingestionRuns.setStatus(run.id, "running");
    const job = await enqueueStage({
      queues: fakeQueues(),
      repos,
      runId: run.id,
      stage: "ingest.read_text",
    });
    repos.jobs.applyEvent({ jobId: job.id, type: "active", at: new Date().toISOString() });
    await syncRunJobs(repos, run.id, async () => ({ state: "failed", failedReason: "boom" }));
    expect(healStuckRun(repos, run.id)).toBe(true);
    const r = repos.ingestionRuns.get(run.id);
    expect(r?.status).toBe("error");
    expect(r?.params.failedTask).toBeUndefined();
  });
});
