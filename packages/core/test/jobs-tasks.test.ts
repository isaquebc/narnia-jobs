import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../src/db";
import { enqueueTask, type TaskJobData, taskJobId } from "../src/jobs/tasks";

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  const added: Array<{ queue: string; name: string; data: TaskJobData; jobId: string }> = [];
  const q = (queue: string) => ({
    add: async (name: string, data: TaskJobData, opts: { jobId: string }) => {
      added.push({ queue, name, data, jobId: opts.jobId });
    },
  });
  return { repos, added, queues: { ingest: q("ingest"), ocr: q("ocr"), extract: q("extract") } };
}

describe("F02/M1 jobs/tasks (jobs fora da cadeia de ingestão, §2.9-1)", () => {
  it("taskJobId não contém ':' e é determinístico por tipo e chave", () => {
    expect(taskJobId("profile.analyze", "usr:1")).toBe("task__profile.analyze__usr_1");
    expect(taskJobId("profile.analyze", "a")).toBe(taskJobId("profile.analyze", "a"));
  });

  it("enfileira na fila pedida com kind task e espelha queued com type, stage = type e profileId", async () => {
    const { repos, added, queues } = setup();
    const { job, enqueued } = await enqueueTask({
      queues,
      repos,
      queue: "extract",
      type: "profile.analyze",
      key: "u1",
      payload: { model: "sonnet" },
      profileId: "p1",
    });
    expect(enqueued).toBe(true);
    expect(job).toMatchObject({
      id: "task__profile.analyze__u1",
      queue: "extract",
      type: "profile.analyze",
      stage: "profile.analyze",
      status: "queued",
      parentId: null,
      profileId: "p1",
      payload: { kind: "task", type: "profile.analyze", key: "u1", payload: { model: "sonnet" } },
    });
    expect(added).toEqual([
      {
        queue: "extract",
        name: "profile.analyze",
        jobId: "task__profile.analyze__u1",
        data: { kind: "task", type: "profile.analyze", key: "u1", payload: { model: "sonnet" } },
      },
    ]);
  });

  it("é idempotente com job pendente (não enfileira de novo) e reenfileira após estado terminal", async () => {
    const { repos, added, queues } = setup();
    const input = { queues, repos, queue: "extract" as const, type: "t", key: "k", payload: {} };
    await enqueueTask(input);
    const second = await enqueueTask(input);
    expect(second.enqueued).toBe(false);
    expect(added).toHaveLength(1);
    repos.jobs.applyEvent({
      jobId: "task__t__k",
      type: "completed",
      at: "2026-10-08T12:00:00.000Z",
    });
    const third = await enqueueTask(input);
    expect(third.enqueued).toBe(true);
    expect(third.job.status).toBe("queued");
    expect(added).toHaveLength(2);
  });
});
