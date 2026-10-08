import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, resetDatabase } from "../../src/db";

function count(db: ReturnType<typeof openDatabase>, table: string): number {
  return (db.prepare(`select count(*) as n from "${table}"`).get() as { n: number }).n;
}

describe("db/reset (M7: isolamento entre cenários e2e, só com provider mock)", () => {
  it("apaga todos os dados do usuário, preserva migrations e referência salarial, zera facts_version e o onboarding", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const userId = repos.users.ensureId();
    repos.settings.set("onboarding", { step: 4, completed: false });
    expect(userId).toBeTruthy();
    repos.facts.skills.insert({ name: "Go", category: "language", confidence: 1, verified: true });
    db.prepare(
      `insert into usage_event (id, ts, origin, category, job_id, session_id, model, input_tokens, output_tokens, cache_read, cache_write, cost_usd_est)
       values ('u1', '2026-10-07T00:00:00.000Z', 'narnia', 'ingest', null, null, 'haiku', 1, 1, 0, 0, 0)`,
    ).run();
    expect(repos.settings.getFactsVersion()).toBeGreaterThan(0);
    const migrationsBefore = count(db, "schema_migrations");
    const refsBefore = count(db, "salary_reference");
    expect(refsBefore).toBeGreaterThan(0);

    const result = resetDatabase(db);

    expect(result.tables).toEqual(
      expect.arrayContaining([
        "user",
        "skill",
        "usage_event",
        "job",
        // F02: tabelas novas também são zeradas
        "profile_emphasis",
        "profile_fact_relevance",
        "profile_suggestion",
        "project",
      ]),
    );
    expect(result.tables).not.toContain("schema_migrations");
    expect(result.tables).not.toContain("salary_reference");
    expect(count(db, "user")).toBe(0);
    expect(count(db, "skill")).toBe(0);
    expect(count(db, "usage_event")).toBe(0);
    expect(count(db, "schema_migrations")).toBe(migrationsBefore);
    expect(count(db, "salary_reference")).toBe(refsBefore);
    expect(repos.settings.get("onboarding")).toBeUndefined();
    expect(repos.settings.getFactsVersion()).toBe(0);
    // continua utilizável depois do reset
    expect(repos.settings.bumpFactsVersion()).toBe(1);
    expect(repos.users.ensureId()).toBeTruthy();
  });
});
