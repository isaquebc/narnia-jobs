import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, type Repos } from "../src/db";
import { enqueueStage, nextStage, planStages, STAGES, stageJobId } from "../src/ingest/chain";

function repos(): Repos {
  const db = openDatabase(":memory:");
  migrate(db);
  return createRepos(db);
}

describe("M4/core cadeia de ingestão (F01 §2.5)", () => {
  it("PDF com tudo ligado = 8 etapas na ordem (F03 acrescenta reconciliação e conferência); texto = 6 etapas", () => {
    expect(planStages({ isPdf: true, options: { ocr: true, modelRead: true } })).toEqual([
      "ingest.read_text",
      "ocr.pages",
      "extract.read_doc",
      "ingest.consolidate",
      "extract.facts",
      "extract.digest",
      "ingest.reconcile",
      "ingest.review_check",
    ]);
    expect(planStages({ isPdf: true, options: { ocr: false, modelRead: true } })).not.toContain(
      "ocr.pages",
    );
    expect(planStages({ isPdf: true, options: { ocr: true, modelRead: false } })).not.toContain(
      "extract.read_doc",
    );
    expect(planStages({ isPdf: false, options: { ocr: true, modelRead: true } })).toEqual([
      "ingest.read_text",
      "ingest.consolidate",
      "extract.facts",
      "extract.digest",
      "ingest.reconcile",
      "ingest.review_check",
    ]);
  });

  it("jobId determinístico por (run, etapa), sem ':' (restrição da BullMQ); cada etapa tem fila e ordem", () => {
    const id = stageJobId("run-1", "extract.facts");
    expect(id).toBe(stageJobId("run-1", "extract.facts"));
    expect(id).not.toContain(":");
    expect(id).toContain("run-1");
    expect(STAGES["ocr.pages"].queue).toBe("ocr");
    expect(STAGES["extract.read_doc"].queue).toBe("extract");
    expect(STAGES["ingest.consolidate"].queue).toBe("ingest");
    expect(STAGES["extract.digest"].order).toBeGreaterThan(STAGES["extract.facts"].order);
  });

  it("nextStage segue o plano e devolve null no fim", () => {
    const plan = planStages({ isPdf: true, options: { ocr: false, modelRead: false } });
    expect(nextStage(plan, "ingest.read_text")).toBe("ingest.consolidate");
    expect(nextStage(plan, "extract.digest")).toBe("ingest.reconcile");
    expect(nextStage(plan, "ingest.review_check")).toBeNull();
  });

  it("enqueueStage adiciona na fila certa com jobId e espelha o job como queued (parentId = runId)", async () => {
    const r = repos();
    const added: Array<{ queue: string; name: string; data: unknown; opts: unknown }> = [];
    const mk = (queue: string) => ({
      add: async (name: string, data: unknown, opts: unknown) => {
        added.push({ queue, name, data, opts });
        return { id: (opts as { jobId: string }).jobId };
      },
    });
    const queues = { ingest: mk("ingest"), ocr: mk("ocr"), extract: mk("extract") };
    const job = await enqueueStage({ queues, repos: r, runId: "run-9", stage: "ocr.pages" });
    expect(added).toHaveLength(1);
    const first = added[0] as { queue: string; data: unknown; opts: { jobId: string } };
    expect(first.queue).toBe("ocr");
    expect(first.data).toEqual({ runId: "run-9", stage: "ocr.pages" });
    expect(first.opts.jobId).toBe(stageJobId("run-9", "ocr.pages"));
    expect(job.status).toBe("queued");
    expect(job.parentId).toBe("run-9");
    expect(r.jobs.get(job.id)?.queue).toBe("ocr");
  });
});

describe("M4/core jobs.requeue", () => {
  it("volta um job em erro para queued, limpando erro, progresso e datas", () => {
    const r = repos();
    r.jobs.upsertQueued({
      id: "j1",
      queue: "extract",
      type: "extract.facts",
      parentId: "run-1",
      profileId: null,
      payload: {},
      stage: "extract.facts",
      at: "2026-10-07T10:00:00.000Z",
    });
    r.jobs.applyEvent({ jobId: "j1", type: "active", at: "2026-10-07T10:00:01.000Z" });
    r.jobs.applyEvent({
      jobId: "j1",
      type: "failed",
      at: "2026-10-07T10:00:02.000Z",
      error: "boom",
      attempts: 1,
    });
    expect(r.jobs.get("j1")?.status).toBe("error");
    const j = r.jobs.requeue("j1", "2026-10-07T10:00:03.000Z");
    expect(j).toMatchObject({
      status: "queued",
      progress: 0,
      error: null,
      finishedAt: null,
      startedAt: null,
    });
    expect(r.jobs.requeue("nope", "2026-10-07T10:00:03.000Z")).toBeNull();
  });
});
