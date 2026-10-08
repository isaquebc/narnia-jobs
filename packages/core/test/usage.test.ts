import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, recordUsage, usageFromSdkResult } from "../src";

describe("usage (medidor: usage_event + JSONL diário, F01 §2.5)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("converte o result do SDK (com e sem campos de cache) e grava tabela + JSONL do dia em UTC", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "narnia-data-"));
    dirs.push(dataDir);
    const db = openDatabase(":memory:");
    migrate(db);
    const r = createRepos(db);
    const full = usageFromSdkResult(
      {
        usage: {
          input_tokens: 5400,
          output_tokens: 900,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 50,
        },
        total_cost_usd: 0.0081,
      },
      { category: "ingest", model: "haiku", jobId: "run-1:extract.facts" },
    );
    expect(full).toMatchObject({
      inputTokens: 5400,
      outputTokens: 900,
      cacheRead: 200,
      cacheWrite: 50,
      costUsdEst: 0.0081,
      origin: "narnia",
      sessionId: null,
    });
    const minimal = usageFromSdkResult(
      { usage: { input_tokens: 10, output_tokens: 2 } },
      { category: "ingest", model: "sonnet" },
    );
    expect(minimal).toMatchObject({ cacheRead: 0, cacheWrite: 0, costUsdEst: 0, jobId: null });

    const e1 = recordUsage(r, dataDir, { ...full, ts: "2026-10-07T23:59:59.000Z" });
    const e2 = recordUsage(r, dataDir, { ...minimal, ts: "2026-10-08T00:00:01.000Z" });
    expect(e1.id).not.toBe(e2.id);
    expect(r.usageEvents.list()).toHaveLength(2);
    const day1 = readFileSync(join(dataDir, "logs", "usage-2026-10-07.jsonl"), "utf8")
      .trim()
      .split("\n");
    const day2 = readFileSync(join(dataDir, "logs", "usage-2026-10-08.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(day1).toHaveLength(1);
    expect(day2).toHaveLength(1);
    expect(JSON.parse(day1[0] as string)).toMatchObject({
      id: e1.id,
      inputTokens: 5400,
      category: "ingest",
    });
    expect(r.usageEvents.summarizeByCategory()).toEqual([
      {
        category: "ingest",
        events: 2,
        inputTokens: 5410,
        outputTokens: 902,
        cacheRead: 200,
        cacheWrite: 50,
        costUsdEst: 0.0081,
      },
    ]);
  });
});
