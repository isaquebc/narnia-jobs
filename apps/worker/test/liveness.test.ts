import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRepos,
  enqueueTask,
  migrate,
  openDatabase,
  type QueueStateFn,
  type Repos,
  synthesisTask,
} from "@narnia-jobs/core";
import { MockProvider } from "@narnia-jobs/providers";
import type { WsEvent } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createBeat, handleFinalFailure, runSweep } from "../src/liveness";
import type { WorkerDeps } from "../src/pipeline";

/** Plano de comunicação C3 (2026-10-11): batimento por job, falha definitiva vinda da fila e verificador periódico. */
const BUDGET = {
  amount: 50_000,
  unit: "thousand" as const,
  depth: "balanced" as const,
  perRepo: 4_000,
  reserve: { synthesis: 6_000, check: 2_000 },
};

function harness() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos: Repos = createRepos(db);
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-liveness-"));
  const published: WsEvent[] = [];
  const queues = (() => {
    const q = { add: async () => {} };
    return { ingest: q, ocr: q, extract: q };
  })();
  const deps: WorkerDeps = {
    repos,
    dataDir,
    provider: new MockProvider(),
    ocr: {
      render: async () => [],
      createRecognizer: async () => ({
        recognize: async () => ({ text: "", confidence: 0 }),
        terminate: async () => {},
      }),
    },
    enqueue: async () => {},
    enqueueTask: async (req) => {
      await enqueueTask({ queues, repos, ...req });
    },
    publish: async (e) => {
      published.push(e);
    },
    gh: () => {
      throw new Error("gh não usado");
    },
  };
  const run = repos.ingestionRuns.createGithub({
    provider: "mock",
    mode: "private",
    depth: "balanced",
    model: "haiku",
    params: { repos: ["ana/api"] },
    budget: BUDGET,
  });
  repos.ingestionRuns.setStatus(run.id, "running");
  const activeSynthesis = async (at: string) => {
    const { job } = await enqueueTask({ queues, repos, ...synthesisTask(run.id) });
    repos.jobs.applyEvent({ jobId: job.id, type: "active", at, stage: job.type });
    return job;
  };
  return {
    repos,
    deps,
    runId: run.id,
    published,
    activeSynthesis,
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}

describe("createBeat · no máximo um batimento a cada 15 s", () => {
  it("primeiro sinal passa; os seguintes só depois de 15 s", async () => {
    let t = 0;
    const calls: number[] = [];
    const beat = createBeat(async () => void calls.push(t), { now: () => t, minMs: 15_000 });
    beat();
    t = 5_000;
    beat();
    t = 14_999;
    beat();
    t = 15_001;
    beat();
    t = 20_000;
    beat();
    await Promise.resolve();
    expect(calls).toEqual([0, 15_001]);
  });
});

describe("handleFinalFailure · falha definitiva vinda da fila (inclusive do verificador de travados)", () => {
  let h: ReturnType<typeof harness>;
  afterEach(() => h?.cleanup());

  it("estado failed na fila: espelho em erro e execução em erro com a tarefa guardada; repetido não duplica", async () => {
    h = harness();
    const job = await h.activeSynthesis(new Date().toISOString());
    const seen = new Set<string>();
    const target = {
      id: job.id,
      queueName: "ingest",
      data: job.payload as never,
      attemptsMade: 2,
      getState: async () => "failed" as const,
    };
    expect(
      await handleFinalFailure(target, "job stalled more than allowable limit", h.deps, seen),
    ).toBe(true);
    expect(
      await handleFinalFailure(target, "job stalled more than allowable limit", h.deps, seen),
    ).toBe(false);
    expect(h.repos.jobs.get(job.id)?.status).toBe("error");
    const run = h.repos.ingestionRuns.get(h.runId);
    expect(run?.status).toBe("error");
    expect((run?.params.failedTask as { type?: string } | undefined)?.type).toBe(
      "ingest.github.synthesis",
    );
  });

  it("ainda com tentativas (estado delayed/waiting): só marca 'tentando de novo'", async () => {
    h = harness();
    const job = await h.activeSynthesis(new Date().toISOString());
    const handled = await handleFinalFailure(
      {
        id: job.id,
        queueName: "ingest",
        data: job.payload as never,
        attemptsMade: 1,
        getState: async () => "delayed" as const,
      },
      "erro",
      h.deps,
      new Set(),
    );
    expect(handled).toBe(false);
    expect(h.repos.jobs.get(job.id)?.stage).toBe("retrying");
    expect(h.repos.ingestionRuns.get(h.runId)?.status).toBe("running");
  });
});

describe("runSweep · verificador periódico", () => {
  let h: ReturnType<typeof harness>;
  afterEach(() => h?.cleanup());

  it("sem a trava, não faz nada", async () => {
    h = harness();
    await h.activeSynthesis(new Date().toISOString());
    const r = await runSweep(h.deps, {
      acquire: async () => false,
      state: async () => ({ state: "failed" }),
    });
    expect(r).toEqual({ ran: false });
    expect(h.repos.ingestionRuns.get(h.runId)?.status).toBe("running");
  });

  it("com a trava, fila failed → execução em erro com a tarefa (mesmo sem ninguém abrir a página)", async () => {
    h = harness();
    await h.activeSynthesis(new Date().toISOString());
    const state: QueueStateFn = async () => ({
      state: "failed",
      failedReason: "job stalled more than allowable limit",
    });
    const r = await runSweep(h.deps, { acquire: async () => true, state });
    expect(r.ran).toBe(true);
    expect(h.repos.ingestionRuns.get(h.runId)?.status).toBe("error");
    expect(h.published.some((e) => e.type === "ingestion.updated")).toBe(true);
  });

  it("ativo sem sinal há mais de 2 min → notificação 'Ingestão parada'; com sinal novo, ela se resolve", async () => {
    h = harness();
    const t0 = new Date("2026-10-11T10:00:00Z");
    const job = await h.activeSynthesis(t0.toISOString());
    const state: QueueStateFn = async () => ({ state: "active" });
    await runSweep(h.deps, {
      acquire: async () => true,
      state,
      now: () => new Date(t0.getTime() + 180_000),
    });
    const open = h.repos.notifications
      .list({ status: "open" })
      .filter((n) => n.kind === "ingestion.stuck");
    expect(open).toHaveLength(1);
    expect(open[0]?.actionUrl).toBe(`/ingestao/${h.runId}`);
    h.repos.jobs.applyEvent({
      jobId: job.id,
      type: "progress",
      at: new Date(t0.getTime() + 190_000).toISOString(),
      progress: 50,
    });
    await runSweep(h.deps, {
      acquire: async () => true,
      state,
      now: () => new Date(t0.getTime() + 200_000),
    });
    expect(
      h.repos.notifications.list({ status: "open" }).filter((n) => n.kind === "ingestion.stuck"),
    ).toHaveLength(0);
  });
});
