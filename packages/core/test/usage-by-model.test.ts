import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../src/db";
import { recordUsage } from "../src/usage";

describe("M4/core usageEvents.summarizeByModel", () => {
  it("soma tokens por modelo", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const dir = mkdtempSync(join(tmpdir(), "narnia-usage-"));
    const base = {
      origin: "narnia" as const,
      jobId: null,
      sessionId: null,
      cacheRead: 0,
      cacheWrite: 0,
      costUsdEst: 0,
    };
    recordUsage(repos, dir, {
      ...base,
      category: "ingest",
      model: "haiku",
      inputTokens: 100,
      outputTokens: 10,
    });
    recordUsage(repos, dir, {
      ...base,
      category: "ingest",
      model: "haiku",
      inputTokens: 50,
      outputTokens: 5,
    });
    recordUsage(repos, dir, {
      ...base,
      category: "ingest",
      model: "sonnet",
      inputTokens: 30,
      outputTokens: 3,
    });
    expect(repos.usageEvents.summarizeByModel()).toEqual({ haiku: 165, sonnet: 33 });
    expect(repos.usageEvents.totalTokens()).toBe(198);
    rmSync(dir, { recursive: true, force: true });
  });
});
