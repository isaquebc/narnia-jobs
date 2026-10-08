import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepos, enqueueStage, migrate, openDatabase } from "@narnia-jobs/core";
import { MockProvider } from "@narnia-jobs/providers";
import { afterAll, describe, expect, it } from "vitest";
import { startWorkers } from "../src/worker";

const REDIS_URL = process.env.REDIS_URL;
const FIXTURES = new URL("../../../packages/core/test/fixtures/", import.meta.url).pathname;

describe.skipIf(!REDIS_URL)("M4/worker integração com Redis real (BullMQ)", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-int-"));
  const dbPath = join(dataDir, "narnia.sqlite");
  const db = openDatabase(dbPath);
  migrate(db);
  const repos = createRepos(db);
  const prefix = `narniatest${Date.now()}`;
  let close: (() => Promise<void>) | null = null;

  afterAll(async () => {
    await close?.();
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("cadeia completa de um PDF chega a review com 6 jobs done no espelho", async () => {
    mkdirSync(join(dataDir, "uploads"), { recursive: true });
    const buf = readFileSync(join(FIXTURES, "cv_text.pdf"));
    const sha = createHash("sha256").update(buf).digest("hex");
    copyFileSync(join(FIXTURES, "cv_text.pdf"), join(dataDir, "uploads", `${sha}.pdf`));
    const file = repos.sourceFiles.insert({
      originalName: "cv_text.pdf",
      mime: "application/pdf",
      size: buf.byteLength,
      sha256: sha,
      path: join("uploads", `${sha}.pdf`),
      kind: "cv",
    });
    const run = repos.ingestionRuns.create({
      fileId: file.id,
      provider: "mock",
      models: { document: "haiku", facts: "haiku", digest: "sonnet" },
      options: { ocr: true, modelRead: true },
    });
    repos.ingestionRuns.setStatus(run.id, "queued");

    const started = await startWorkers({
      redisUrl: REDIS_URL as string,
      prefix,
      dbPath,
      dataDir,
      provider: new MockProvider(),
      ocr: {
        render: async (_pdf, outDir) => {
          const p = join(outDir, "page-1.png");
          copyFileSync(join(FIXTURES, "cv_text.pdf"), p);
          return [p];
        },
        createRecognizer: async () => ({
          recognize: async () => ({ text: "ANA MARIA EXEMPLO\nAcme Ltda", confidence: 0.9 }),
          terminate: async () => {},
        }),
      },
      heartbeatMs: 1000,
    });
    close = started.close;

    await enqueueStage({ queues: started.queues, repos, runId: run.id, stage: "ingest.read_text" });

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const status = repos.ingestionRuns.get(run.id)?.status;
      if (status === "review" || status === "error") break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const finalRun = repos.ingestionRuns.get(run.id);
    expect(finalRun?.status).toBe("review");
    // espelho: eventos chegam logo depois do processamento; aguarda convergir
    const jobsDeadline = Date.now() + 5_000;
    let jobs = repos.jobs.list({ parentId: run.id });
    while (
      Date.now() < jobsDeadline &&
      !(jobs.length === 6 && jobs.every((j) => j.status === "done"))
    ) {
      await new Promise((r) => setTimeout(r, 100));
      jobs = repos.jobs.list({ parentId: run.id });
    }
    expect(jobs).toHaveLength(6);
    expect(jobs.every((j) => j.status === "done")).toBe(true);
    expect(await started.heartbeat()).not.toBeNull();
    expect(repos.proposals.listByRun(run.id).length).toBeGreaterThan(5);
  }, 60_000);
});
