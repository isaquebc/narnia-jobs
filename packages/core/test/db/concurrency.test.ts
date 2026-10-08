import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";

describe("db/concurrency (api e worker no mesmo arquivo: WAL + busy_timeout)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("duas conexões escrevem alternadamente e leem o estado uma da outra", () => {
    const dir = mkdtempSync(join(tmpdir(), "narnia-db-"));
    dirs.push(dir);
    const path = join(dir, "narnia.sqlite");
    const a = openDatabase(path);
    migrate(a);
    const b = openDatabase(path);
    const ra = createRepos(a);
    const rb = createRepos(b);
    ra.users.upsert({ fullName: "Ana" });
    for (let i = 0; i < 20; i++) {
      (i % 2 ? ra : rb).facts.skills.insert({
        name: `skill-${i}`,
        category: "other",
        confidence: 1,
        verified: true,
      });
    }
    expect(ra.facts.skills.count()).toBe(20);
    expect(rb.facts.skills.count()).toBe(20);
    expect(rb.settings.getFactsVersion()).toBe(20);
    rb.jobs.upsertQueued({
      id: "j1",
      queue: "ingest",
      type: "ingest.read_text",
      parentId: null,
      profileId: null,
      payload: {},
      stage: "queued",
      at: "2026-10-07T12:00:00.000Z",
    });
    expect(ra.jobs.get("j1")?.status).toBe("queued");
    a.close();
    b.close();
  });

  it("escrita durante transação aberta em outra conexão espera (busy_timeout) em vez de falhar na hora", () => {
    const dir = mkdtempSync(join(tmpdir(), "narnia-db-"));
    dirs.push(dir);
    const path = join(dir, "narnia.sqlite");
    const a = openDatabase(path);
    migrate(a);
    const b = openDatabase(path);
    b.exec("pragma busy_timeout = 300");
    a.exec("begin immediate");
    a.prepare("insert into settings (key, value_json) values ('x', '1')").run();
    const started = Date.now();
    expect(() =>
      b.prepare("insert into settings (key, value_json) values ('y', '2')").run(),
    ).toThrow(/busy|locked/i);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    a.exec("commit");
    b.prepare("insert into settings (key, value_json) values ('y', '2')").run();
    expect((a.prepare("select count(*) as n from settings").get() as { n: number }).n).toBe(3);
    a.close();
    b.close();
  });
});
