import { createRepos, migrate, openDatabase, stageJobId } from "@narnia-jobs/core";
import type { WsEvent } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { handleQueueEvent } from "../src/events";

describe("M4/worker eventos da BullMQ → espelho em `job` + evento WS publicado", () => {
  it("active/progress/completed/failed/stalled atualizam o espelho em ordem e publicam uma vez cada", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const published: WsEvent[] = [];
    const deps = { repos, publish: async (e: WsEvent) => void published.push(e) };
    const id = stageJobId("run-1", "extract.facts");
    repos.jobs.upsertQueued({
      id,
      queue: "extract",
      type: "extract.facts",
      parentId: "run-1",
      profileId: null,
      payload: { runId: "run-1", stage: "extract.facts" },
      stage: "extract.facts",
      at: "2026-10-07T10:00:00.000Z",
    });
    await handleQueueEvent({ type: "active", jobId: id, at: "2026-10-07T10:00:01.000Z" }, deps);
    expect(repos.jobs.get(id)?.status).toBe("active");
    await handleQueueEvent(
      { type: "progress", jobId: id, progress: 40, at: "2026-10-07T10:00:02.000Z" },
      deps,
    );
    expect(repos.jobs.get(id)?.progress).toBe(40);
    await handleQueueEvent({ type: "stalled", jobId: id, at: "2026-10-07T10:00:03.000Z" }, deps);
    expect(repos.jobs.get(id)?.status).toBe("stalled");
    await handleQueueEvent(
      { type: "completed", jobId: id, at: "2026-10-07T10:00:04.000Z", result: { ok: 1 } },
      deps,
    );
    expect(repos.jobs.get(id)?.status).toBe("done");
    await handleQueueEvent(
      { type: "failed", jobId: id, at: "2026-10-07T10:00:05.000Z", error: "x" },
      deps,
    );
    expect(repos.jobs.get(id)?.status).toBe("done"); // terminal não rebaixa
    expect(published.map((e) => e.type)).toEqual([
      "job.progress",
      "job.progress",
      "job.progress",
      "job.done",
      "job.error",
    ]);
    const progress = published[2] as Extract<WsEvent, { type: "job.progress" }>;
    expect(progress.stage).toBe("stalled");
  });

  it("evento para job desconhecido no espelho é ignorado sem publicar", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const published: WsEvent[] = [];
    await handleQueueEvent(
      { type: "active", jobId: "nao-existe", at: "2026-10-07T10:00:00.000Z" },
      { repos, publish: async (e) => void published.push(e) },
    );
    expect(published).toHaveLength(0);
  });
});
