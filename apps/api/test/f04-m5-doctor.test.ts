import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider } from "@narnia-jobs/providers";
import { afterEach, describe, expect, it } from "vitest";
import { runDoctor } from "../src/doctor";
import { probeMcp } from "../src/mcp/probe";
import { makeTestApp, type TestApp, TOKEN } from "./helpers";

/** F04/M5 · `doctor` confere o servidor MCP da instância (initialize + tools/list autenticados). */
describe("F04/M5 · doctor com MCP", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  it("probeMcp lista as tools autenticado e falha sem token", async () => {
    t = makeTestApp();
    const app = t.app;
    const fetchApp = (url: URL | string, init?: RequestInit) =>
      Promise.resolve(app.fetch(new Request(url, init)));
    const n = await probeMcp("http://narnia.test", TOKEN, fetchApp);
    expect(n).toBeGreaterThan(10);
    await expect(probeMcp("http://narnia.test", "token-errado", fetchApp)).rejects.toThrow();
  });

  it("runDoctor inclui o MCP: ok com tools; falha vira dica e derruba o ok", async () => {
    const dir = mkdtempSync(join(tmpdir(), "narnia-doctor-mcp-"));
    try {
      const base = {
        provider: new MockProvider(),
        dataDir: dir,
        redisPing: async () => "PONG",
        workerHeartbeat: async () => new Date().toISOString(),
      };
      const good = await runDoctor({ ...base, mcpProbe: async () => 31 });
      expect(good.checks.mcp).toEqual({ ok: true, tools: 31 });
      expect(good.ok).toBe(true);
      const bad = await runDoctor({
        ...base,
        mcpProbe: async () => {
          throw new Error("401");
        },
      });
      expect(bad.checks.mcp).toEqual({ ok: false, tools: 0 });
      expect(bad.ok).toBe(false);
      expect(bad.hints.join(" ")).toMatch(/MCP/);
      const none = await runDoctor(base);
      expect(none.checks.mcp).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
