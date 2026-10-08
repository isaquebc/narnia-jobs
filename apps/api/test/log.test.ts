import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJsonlLogger } from "../src/log";
import { makeTestApp, type TestApp } from "./helpers";

describe("M4/api logs JSONL próprios", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("createJsonlLogger grava uma linha por entrada no arquivo do dia (UTC)", () => {
    const dir = mkdtempSync(join(tmpdir(), "narnia-log-"));
    const log = createJsonlLogger(dir, "api");
    log({ ts: "2026-10-07T10:00:00.000Z", method: "GET", path: "/api/health", status: 200, ms: 1 });
    log({
      ts: "2026-10-07T23:59:59.000Z",
      method: "POST",
      path: "/api/files",
      status: 201,
      ms: 12,
    });
    const file = join(dir, "logs", "api-2026-10-07.jsonl");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it("requisições à API são registradas (método, rota, status, duração)", async () => {
    t = makeTestApp();
    await t.api("/api/provider/status");
    await t.app.request("/api/health");
    const files = readdirSync(join(t.dataDir, "logs")).filter((f) => f.startsWith("api-"));
    expect(files).toHaveLength(1);
    const lines = readFileSync(join(t.dataDir, "logs", files[0] as string), "utf8")
      .trim()
      .split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      method: "GET",
      path: "/api/provider/status",
      status: 200,
    });
  });
});
