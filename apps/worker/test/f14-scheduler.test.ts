import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRepos,
  migrate,
  openDatabase,
  type Repos,
  type TaskRequest,
} from "@narnia-jobs/core";
import { MockProvider } from "@narnia-jobs/providers";
import type { WsEvent } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkerDeps } from "../src/pipeline";
import { enqueueDueScheduledTasks } from "../src/processors/scheduled-run";
import { processTask } from "../src/tasks";

/** F14/M1 · agendador no worker: o laço enfileira as devidas na fila `scheduled`; a tarefa `scheduled.run` executa. */
function harness() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos: Repos = createRepos(db);
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-worker-sched-"));
  const enqueued: TaskRequest[] = [];
  const events: WsEvent[] = [];
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
      enqueued.push(req);
    },
    publish: async (e) => {
      events.push(e);
    },
    gh: () => {
      throw new Error("gh não usado");
    },
  };
  return {
    repos,
    dataDir,
    deps,
    enqueued,
    events,
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}

describe("F14/M1 · agendador no worker", () => {
  let h: ReturnType<typeof harness>;
  afterEach(() => h?.cleanup());

  it("o laço enfileira cada tarefa devida na fila scheduled, com a chave da tarefa", async () => {
    h = harness();
    const due = await enqueueDueScheduledTasks(h.deps, new Date("2026-11-11T12:00:00Z"));
    expect(due).toEqual([
      "mail.sync",
      "postings.auto_analyze",
      "postings.feed_archive",
      "captures.prune",
      "job_applications.archive",
      "todos.reminders",
    ]);
    expect(h.enqueued).toEqual([
      {
        queue: "scheduled",
        type: "scheduled.run",
        key: "mail.sync",
        payload: { taskId: "mail.sync", trigger: "schedule" },
      },
      {
        queue: "scheduled",
        type: "scheduled.run",
        key: "postings.auto_analyze",
        payload: { taskId: "postings.auto_analyze", trigger: "schedule" },
      },
      {
        queue: "scheduled",
        type: "scheduled.run",
        key: "postings.feed_archive",
        payload: { taskId: "postings.feed_archive", trigger: "schedule" },
      },
      {
        queue: "scheduled",
        type: "scheduled.run",
        key: "captures.prune",
        payload: { taskId: "captures.prune", trigger: "schedule" },
      },
      {
        queue: "scheduled",
        type: "scheduled.run",
        key: "job_applications.archive",
        payload: { taskId: "job_applications.archive", trigger: "schedule" },
      },
      {
        queue: "scheduled",
        type: "scheduled.run",
        key: "todos.reminders",
        payload: { taskId: "todos.reminders", trigger: "schedule" },
      },
    ]);
  });

  it("scheduled.run executa a tarefa, publica o andamento e tira a tarefa das devidas", async () => {
    h = harness();
    const out = await processTask(
      {
        kind: "task",
        type: "scheduled.run",
        key: "captures.prune",
        payload: { taskId: "captures.prune", trigger: "manual" },
      },
      { jobId: "j1", progress: async () => {} },
      h.deps,
    );
    expect(out.status).toBe("done");
    expect(h.repos.scheduled.run(String(out.runId))?.trigger).toBe("manual");
    expect(h.events.map((e) => e.type)).toEqual(["scheduled_run.updated", "scheduled_run.updated"]);
    expect(await enqueueDueScheduledTasks(h.deps)).toEqual([
      "mail.sync",
      "postings.auto_analyze",
      "postings.feed_archive",
      "job_applications.archive",
      "todos.reminders",
    ]);
  });

  it("tarefa desconhecida falha (o job vai para erro)", async () => {
    h = harness();
    await expect(
      processTask(
        { kind: "task", type: "scheduled.run", key: "x", payload: { taskId: "x" } },
        { jobId: "j1", progress: async () => {} },
        h.deps,
      ),
    ).rejects.toThrow(/desconhecida/);
  });
});

describe("F14/M1 · revisão: o laço cura estados que tirariam a tarefa do agendador", () => {
  let h: ReturnType<typeof harness>;
  afterEach(() => h?.cleanup());
  const T = new Date("2026-11-11T12:00:00Z");

  it("execução presa em running com o job já terminado vira erro e a tarefa volta a ser enfileirada", async () => {
    h = harness();
    h.repos.scheduled.startRun({
      taskId: "captures.prune",
      trigger: "schedule",
      at: T.toISOString(),
    });
    const due = await enqueueDueScheduledTasks(h.deps, T, async () => "missing");
    expect(due).toContain("captures.prune");
    expect(h.repos.scheduled.lastRun("captures.prune")?.status).toBe("error");
  });

  it("espelho pendente sem job no Redis é cancelado e a tarefa entra de novo", async () => {
    h = harness();
    const { enqueueTask } = await import("@narnia-jobs/core");
    const fake = { add: async () => {} };
    await enqueueTask({
      queues: { ingest: fake, ocr: fake, extract: fake, scheduled: fake },
      repos: h.repos,
      queue: "scheduled",
      type: "scheduled.run",
      key: "captures.prune",
      payload: { taskId: "captures.prune", trigger: "manual" },
    });
    await enqueueDueScheduledTasks(h.deps, T, async () => "missing");
    expect(h.repos.jobs.get("task__scheduled.run__captures.prune")?.status).toBe("cancelled");
    expect(h.enqueued.map((r) => r.key)).toContain("captures.prune");
  });

  it("job pendente que ainda está na fila: nada muda", async () => {
    h = harness();
    h.repos.scheduled.startRun({
      taskId: "captures.prune",
      trigger: "schedule",
      at: T.toISOString(),
    });
    const { enqueueTask } = await import("@narnia-jobs/core");
    const fake = { add: async () => {} };
    await enqueueTask({
      queues: { ingest: fake, ocr: fake, extract: fake, scheduled: fake },
      repos: h.repos,
      queue: "scheduled",
      type: "scheduled.run",
      key: "captures.prune",
      payload: { taskId: "captures.prune", trigger: "schedule" },
    });
    const due = await enqueueDueScheduledTasks(h.deps, T, async () => "active");
    expect(due).not.toContain("captures.prune");
    expect(h.repos.scheduled.isRunning("captures.prune")).toBe(true);
  });
});
