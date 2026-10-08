import { existsSync } from "node:fs";
import { join } from "node:path";
import { ClaudeCodeProvider } from "@narnia-jobs/providers";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { EventBus } from "../src/events";
import { FakeQueueAdapter, makeTestApp, type TestApp, uploadFixture, VALID_USER } from "./helpers";

describe("M7/api POST /api/_test/reset (isolamento dos cenários e2e; só com provider mock)", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("apaga dados, arquivos enviados e estado do wizard, e devolve o mock aos padrões", async () => {
    t = makeTestApp();
    await t.api("/api/user", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(VALID_USER),
    });
    await t.api("/api/onboarding/state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ step: 4, completed: false }),
    });
    await t.api("/api/_test/mock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ loggedIn: false, delayMs: 50 }),
    });
    await uploadFixture(t);
    expect(existsSync(join(t.dataDir, "uploads"))).toBe(true);

    const res = await t.api("/api/_test/reset", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tables: string[] };
    expect(body.ok).toBe(true);
    expect(body.tables).toEqual(expect.arrayContaining(["user", "source_file", "job"]));

    expect(await (await t.api("/api/user")).json()).toEqual({ user: null });
    expect(await (await t.api("/api/onboarding/state")).json()).toEqual({
      step: 1,
      completed: false,
    });
    expect(await (await t.api("/api/provider/status")).json()).toMatchObject({ loggedIn: true });
    expect(t.provider.getMode().delayMs).toBe(0);
    expect(existsSync(join(t.dataDir, "uploads"))).toBe(false);
    expect(
      ((await (await t.api("/api/dashboard")).json()) as { counts: { files: number } }).counts
        .files,
    ).toBe(0);
    expect(t.events.some((e) => e.type === "provider.status")).toBe(true);
  });

  it("não existe quando o provider não é o mock", async () => {
    t = makeTestApp();
    const app = createApp({
      version: "x",
      repos: t.repos,
      dataDir: t.dataDir,
      provider: new ClaudeCodeProvider({
        exec: async () => ({ stdout: "", stderr: "", code: 1 }),
        binaryPath: "/nope",
      }),
      queue: new FakeQueueAdapter(t.repos),
      bus: new EventBus(),
      token: "tk",
    });
    const res = await app.request("/api/_test/reset", {
      method: "POST",
      headers: { Authorization: "Bearer tk" },
    });
    expect(res.status).toBe(404);
  });
});
