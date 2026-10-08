import { ClaudeCodeProvider } from "@narnia-jobs/providers";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { EventBus } from "../src/events";
import { FakeQueueAdapter, makeTestApp, type TestApp } from "./helpers";

describe("M4/api provider/status e endpoint de teste do mock", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("GET /api/provider/status reflete o detect() e POST /api/_test/mock muda o modo e emite provider.status", async () => {
    t = makeTestApp();
    expect(await (await t.api("/api/provider/status")).json()).toMatchObject({
      installed: true,
      loggedIn: true,
      authMethod: "claude.ai",
    });
    const res = await t.api("/api/_test/mock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ loggedIn: false }),
    });
    expect(res.status).toBe(200);
    expect(await (await t.api("/api/provider/status")).json()).toMatchObject({
      loggedIn: false,
      authMethod: "none",
    });
    expect(t.events.some((e) => e.type === "provider.status")).toBe(true);
    await t.api("/api/_test/mock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ loggedIn: true, authMethod: "oauth_token" }),
    });
    expect(await (await t.api("/api/provider/status")).json()).toMatchObject({
      authMethod: "oauth_token",
    });
  });

  it("endpoint de teste não existe quando o provider não é o mock", async () => {
    t = makeTestApp();
    const real = new ClaudeCodeProvider({
      exec: async () => ({ stdout: "", stderr: "", code: 1 }),
      binaryPath: "/nope",
    });
    const app = createApp({
      version: "x",
      repos: t.repos,
      dataDir: t.dataDir,
      provider: real,
      queue: new FakeQueueAdapter(t.repos),
      bus: new EventBus(),
      token: "tk",
    });
    const res = await app.request("/api/_test/mock", {
      method: "POST",
      headers: { Authorization: "Bearer tk", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });
});
