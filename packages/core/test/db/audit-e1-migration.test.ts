import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * Auditoria pós-F04 · bloco E1 · migration 0005: a fonte confirmada pelo usuário (F04-5). O upgrade parte de um banco
 * 0004 com fontes gravadas pelo repositório de produção; as existentes ficam "não confirmadas".
 */
describe("migration 0005_research_confirmed", () => {
  it("upgrade preserva as fontes e as marca como não confirmadas; as novas gravam a confirmação", () => {
    const db = openDatabase(":memory:");
    migrate(db, { until: "0004_chat" });
    const repos = createRepos(db);
    const ids = seedFixture(repos, "engineer");
    db.prepare(
      `insert into research_source (id, profile_id, session_id, url, domain, title, excerpt, used_for, trust_tag, accessed_at)
       values ('src-1', ?, null, 'https://www.ibge.gov.br/x', 'ibge.gov.br', 'IBGE', 'x', 'salary', 'official',
               '2026-10-11T00:00:00.000Z')`,
    ).run(ids.profileId);
    expect(migrate(db, { until: "0005_research_confirmed" }).applied).toEqual([
      "0005_research_confirmed",
    ]);
    const after = createRepos(db);
    expect(after.researchSources.get("src-1")).toMatchObject({
      domain: "ibge.gov.br",
      userConfirmed: false,
      accepted: null,
    });
    const saved = after.researchSources.add({
      profileId: ids.profileId,
      sessionId: null,
      url: "https://blog.exemplo.com/a",
      domain: "blog.exemplo.com",
      title: "Blog",
      excerpt: "x",
      usedFor: "salary",
      trustTag: "other",
      userConfirmed: true,
    });
    expect(after.researchSources.get(saved.id)?.userConfirmed).toBe(true);
    expect(db.prepare("pragma foreign_key_check").all()).toEqual([]);
  });
});
