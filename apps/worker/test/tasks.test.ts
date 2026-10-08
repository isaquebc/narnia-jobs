import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRepos,
  migrate,
  openDatabase,
  type Repos,
  seedFixture,
  type TaskJobData,
} from "@narnia-jobs/core";
import { MockProvider } from "@narnia-jobs/providers";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkerDeps } from "../src/pipeline";
import { isTaskJob, processTask, type TaskContext, TaskError } from "../src/tasks";

function harness(provider = new MockProvider()) {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos: Repos = createRepos(db);
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-worker-tasks-"));
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
    enqueue: async () => {},
  };
  const progress: number[] = [];
  const ctx: TaskContext = {
    jobId: "task__profile.analyze__u1",
    progress: async (pct) => {
      progress.push(pct);
    },
  };
  return {
    repos,
    dataDir,
    deps,
    ctx,
    progress,
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}

const DATA: TaskJobData = { kind: "task", type: "profile.analyze", key: "u1", payload: {} };

describe("F02/M3 worker · jobs de tarefa (despacho stage | task) e profile.analyze", () => {
  let h: ReturnType<typeof harness>;
  afterEach(() => h?.cleanup());

  it("isTaskJob distingue dados de tarefa dos de etapa", () => {
    expect(isTaskJob(DATA)).toBe(true);
    expect(isTaskJob({ runId: "r", stage: "extract.facts" })).toBe(false);
  });

  it("profile.analyze: chama o provider com o histórico e o modelo, grava sugestões source=model, registra uso e devolve {created, skipped}", async () => {
    h = harness();
    seedFixture(h.repos, "leader");
    h.repos.settings.set("models", { analyze: "opus" });
    const result = (await processTask(DATA, h.ctx, h.deps)) as { created: number; skipped: number };
    expect(result).toMatchObject({ created: 2, skipped: 0, model: "opus" });
    const stored = h.repos.suggestions.list({ status: "new" }).filter((s) => s.source === "model");
    expect(stored.map((s) => s.payload.title).sort()).toEqual([
      "Engineering Manager",
      "Staff Engineer",
    ]);
    expect(stored.every((s) => s.model === "opus")).toBe(true);
    expect(stored[0]?.payload.supportingFactIds.length).toBeGreaterThan(0);
    const usage = h.repos.usageEvents.list();
    expect(usage.some((u) => u.category === "profile.analyze" && u.model === "opus")).toBe(true);
    expect(h.progress.at(-1)).toBe(100);
  });

  it("profile.analyze é idempotente por título: segunda execução não duplica (skipped)", async () => {
    h = harness();
    seedFixture(h.repos, "leader");
    await processTask(DATA, h.ctx, h.deps);
    const again = (await processTask(DATA, h.ctx, h.deps)) as { created: number; skipped: number };
    expect(again).toMatchObject({ created: 0, skipped: 2 });
    expect(h.repos.suggestions.list().filter((s) => s.source === "model")).toHaveLength(2);
  });

  it("tipo desconhecido falha com erro tipado; erro do provider propaga a mensagem", async () => {
    h = harness(new MockProvider({ errors: { analyzeProfiles: "modelo indisponível" } }));
    seedFixture(h.repos, "engineer");
    await expect(processTask({ ...DATA, type: "nope" }, h.ctx, h.deps)).rejects.toMatchObject({
      code: "unknown_task",
    });
    await expect(processTask(DATA, h.ctx, h.deps)).rejects.toThrow(/modelo indisponível/);
    expect(TaskError).toBeDefined();
  });
});
