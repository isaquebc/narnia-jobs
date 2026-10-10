import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { planSnapshotPrune, syncSnapshotCapNotification } from "../../src/ingest/snapshot-cap";

/** Plano de correções F03, item 15: teto de snapshots com aviso e LRU. */
function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  return createRepos(db);
}
const add = (repos: ReturnType<typeof setup>, ref: string, size: number) =>
  repos.snapshots.create({
    source: "github",
    ref,
    headSha: null,
    path: `/x/${ref}`,
    sha256: "a".repeat(64),
    size,
  });

describe("F03 fix L3 · item 15: teto de snapshots", () => {
  it("lru ordena pelo último uso (o menos usado primeiro)", () => {
    const repos = setup();
    const a = add(repos, "a/a", 10);
    const b = add(repos, "b/b", 10);
    add(repos, "c/c", 10);
    repos.snapshots.touch(a.id);
    expect(repos.snapshots.lru().map((s) => s.ref)).toEqual(["b/b", "c/c", "a/a"]);
    expect(b.id).toBeTruthy();
  });

  it("acima do teto gera a notificação; abaixo resolve", () => {
    const repos = setup();
    add(repos, "a/a", 600);
    add(repos, "b/b", 600);
    const created = syncSnapshotCapNotification(repos, 1_000);
    expect(created.map((e) => e.notification.kind)).toEqual(["snapshots.over_cap"]);
    expect(repos.notifications.list({ status: "open" }).map((n) => n.kind)).toEqual([
      "snapshots.over_cap",
    ]);
    const resolved = syncSnapshotCapNotification(repos, 5_000);
    expect(resolved.map((e) => e.notification.resolvedAt !== null)).toEqual([true]);
    expect(repos.notifications.list({ status: "open" })).toEqual([]);
  });

  it("planSnapshotPrune escolhe os menos usados até caber no teto", () => {
    const repos = setup();
    const old = add(repos, "old/old", 500);
    const mid = add(repos, "mid/mid", 500);
    const fresh = add(repos, "new/new", 500);
    repos.snapshots.touch(fresh.id);
    expect(planSnapshotPrune(repos, 1_000).map((s) => s.id)).toEqual([old.id]);
    expect(planSnapshotPrune(repos, 400).map((s) => s.id)).toEqual([old.id, mid.id, fresh.id]);
    expect(planSnapshotPrune(repos, 2_000)).toEqual([]);
  });
});
