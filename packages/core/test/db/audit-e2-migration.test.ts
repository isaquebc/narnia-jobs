import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * Auditoria pós-F04 · bloco E2 · migration 0006: categoria `discovery` (entrevista de descoberta, passo 7 do primeiro
 * uso). O SQLite não altera CHECK: `chat_session` é reconstruída; o upgrade parte de um banco 0005 com sessão,
 * mensagens, fonte e uso gravados pelos repositórios de produção, e nada pode se perder nem quebrar referência.
 */
describe("migration 0006_chat_discovery", () => {
  it("upgrade preserva sessões, mensagens, fontes e uso; a categoria discovery passa a valer", () => {
    const db = openDatabase(":memory:");
    migrate(db, { until: "0005_research_confirmed" });
    const repos = createRepos(db);
    const ids = seedFixture(repos, "engineer");
    const s = repos.chatSessions.create({
      profileId: ids.profileId,
      category: "career",
      title: "Antiga",
      provider: "mock",
      model: "sonnet",
    });
    repos.chatMessages.add({
      sessionId: s.id,
      turnIndex: 0,
      role: "user",
      contentMd: "olá",
      toolCalls: [],
      usage: null,
    });
    const src = repos.researchSources.add({
      profileId: ids.profileId,
      sessionId: s.id,
      url: "https://www.ibge.gov.br/x",
      domain: "ibge.gov.br",
      title: "IBGE",
      excerpt: "x",
      usedFor: "salary",
      trustTag: "official",
    });
    expect(migrate(db).applied).toEqual(["0006_chat_discovery"]);
    const after = createRepos(db);
    expect(after.chatSessions.get(s.id)).toMatchObject({ title: "Antiga", category: "career" });
    expect(after.chatMessages.list(s.id).map((m) => m.contentMd)).toEqual(["olá"]);
    expect(after.researchSources.get(src.id)?.sessionId).toBe(s.id);
    const d = after.chatSessions.create({
      profileId: ids.profileId,
      category: "discovery",
      title: "Entrevista de descoberta",
      provider: "mock",
      model: "sonnet",
    });
    expect(after.chatSessions.get(d.id)?.category).toBe("discovery");
    expect(() =>
      db
        .prepare(
          "insert into chat_session (id, profile_id, category, title, provider, model, created_at, last_activity_at) values ('x', ?, 'magia', 't', 'p', 'm', 'a', 'a')",
        )
        .run(ids.profileId),
    ).toThrow(/CHECK/);
    // apagar a sessão ainda leva as mensagens junto (cascade da chave estrangeira apontando para a tabela nova)
    after.chatSessions.remove(s.id);
    expect(after.chatMessages.list(s.id)).toEqual([]);
    expect(after.researchSources.get(src.id)?.sessionId).toBeNull();
    expect(db.prepare("pragma foreign_key_check").all()).toEqual([]);
  });
});
