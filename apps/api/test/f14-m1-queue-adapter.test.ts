import { createRepos, enqueueTask, migrate, openDatabase, type Repos } from "@narnia-jobs/core";
import type { Queue } from "bullmq";
import { describe, expect, it } from "vitest";
import { BullQueueAdapter } from "../src/queue";

/**
 * F14/M1 · defeito 3 da revisão contra o código (§2.0.4): "tentar de novo" numa tarefa cancelada ou removida da fila
 * devolvia false (o tipo não é etapa da ingestão) e a rota respondia 500 com o espelho preso em `queued`.
 */
interface FakeJob {
  id: string;
  name: string;
  data: unknown;
  state: string;
  removed: boolean;
  retried: number;
}

function fakeQueue() {
  const jobs = new Map<string, FakeJob>();
  const added: Array<{ name: string; data: unknown; jobId: string }> = [];
  const queue = {
    jobs,
    added,
    async add(name: string, data: unknown, opts: { jobId: string }) {
      added.push({ name, data, jobId: opts.jobId });
      jobs.set(opts.jobId, {
        id: opts.jobId,
        name,
        data,
        state: "waiting",
        removed: false,
        retried: 0,
      });
      return {};
    },
    async getJob(id: string) {
      const j = jobs.get(id);
      if (!j || j.removed) return undefined;
      return {
        id,
        failedReason: null,
        getState: async () => j.state,
        remove: async () => {
          j.removed = true;
          jobs.delete(id);
        },
        retry: async () => {
          j.retried++;
          j.state = "waiting";
        },
      };
    },
  };
  return queue;
}

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos: Repos = createRepos(db);
  const queues = {
    ingest: fakeQueue(),
    ocr: fakeQueue(),
    extract: fakeQueue(),
    media: fakeQueue(),
    scheduled: fakeQueue(),
  };
  const adapter = new BullQueueAdapter(
    queues as unknown as Record<keyof typeof queues, Queue>,
    repos,
  );
  return { repos, queues, adapter };
}

describe("F14/M1 · BullQueueAdapter.retry (defeito 3)", () => {
  it("tarefa falha que ainda está na fila: usa o retry da BullMQ", async () => {
    const { repos, queues, adapter } = setup();
    const { job } = await enqueueTask({
      queues,
      repos,
      queue: "extract",
      type: "posting.extract",
      key: "p1",
    });
    const fake = queues.extract.jobs.get(job.id);
    if (!fake) throw new Error("job ausente");
    fake.state = "failed";
    expect(await adapter.retry(job.id)).toBe(true);
    expect(fake.retried).toBe(1);
  });

  it("tarefa cancelada (fora da fila): reenfileira com o mesmo id e os mesmos dados", async () => {
    const { repos, queues, adapter } = setup();
    const { job } = await enqueueTask({
      queues,
      repos,
      queue: "extract",
      type: "posting.extract",
      key: "p1",
      payload: { postingId: "p1" },
    });
    queues.extract.jobs.delete(job.id);
    expect(await adapter.retry(job.id)).toBe(true);
    const last = queues.extract.added.at(-1);
    expect(last?.jobId).toBe(job.id);
    expect(last?.data).toEqual({
      kind: "task",
      type: "posting.extract",
      key: "p1",
      payload: { postingId: "p1" },
    });
  });

  it("tarefa ainda presente e não falha (ex.: cancelada mas não removida): remove e reenfileira", async () => {
    const { repos, queues, adapter } = setup();
    const { job } = await enqueueTask({
      queues,
      repos,
      queue: "media",
      type: "recording.analyze",
      key: "r1",
    });
    const before = queues.media.added.length;
    expect(await adapter.retry(job.id)).toBe(true);
    expect(queues.media.added.length).toBe(before + 1);
  });

  it("job desconhecido no espelho: false", async () => {
    const { adapter } = setup();
    expect(await adapter.retry("nope")).toBe(false);
  });
});
