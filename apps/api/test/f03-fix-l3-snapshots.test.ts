import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { INGEST_SETTING_KEYS } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/** Plano de correções F03, item 15 (api): poda dos menos usados até caber, com aviso resolvido. */
// biome-ignore lint/suspicious/noExplicitAny: corpo lido de forma solta
type Body = any;

describe("F03 fix L3 · item 15: POST /api/snapshots/prune", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("apaga os menos usados até caber no teto e resolve a notificação", async () => {
    t = makeTestApp();
    const mk = (ref: string, size: number) => {
      const dir = join(t.dataDir, "snapshots", "github", ref.replace("/", "__"));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "x.json"), "{}");
      return t.repos.snapshots.create({
        source: "github",
        ref,
        headSha: null,
        path: dir,
        sha256: "a".repeat(64),
        size,
      });
    };
    const old = mk("old/old", 600);
    const fresh = mk("new/new", 600);
    t.repos.snapshots.touch(fresh.id);
    t.repos.settings.set(INGEST_SETTING_KEYS.snapshotsMaxBytes, 1_000);
    const list = (await (await t.api("/api/snapshots")).json()) as Body;
    expect(list.snapshots.map((s: Body) => s.ref)).toEqual(["old/old", "new/new"]);
    expect(t.repos.notifications.list({ status: "open" }).map((n) => n.kind)).toContain(
      "snapshots.over_cap",
    );

    const res = await t.api("/api/snapshots/prune", { method: "POST" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Body).removed).toBe(1);
    expect(existsSync(old.path)).toBe(false);
    expect(existsSync(fresh.path)).toBe(true);
    expect(t.repos.notifications.list({ status: "open" }).map((n) => n.kind)).not.toContain(
      "snapshots.over_cap",
    );
  });
});
