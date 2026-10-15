import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * Migration 0011: recrutador global (F06-8). A conversa deixa de pertencer a um perfil: `profile_id` vira contexto
 * opcional (apagar o perfil não apaga a conversa) e entra a categoria `job` (análise de vaga).
 */
describe("migration 0011_global_chat", () => {
  it("conversas antigas continuam com perfil, mensagens e marca de leitura", () => {
    const db = openDatabase(":memory:");
    migrate(db, { until: "0010_chat_read" });
    const repos = createRepos(db);
    const ids = seedFixture(repos, "engineer");
    const s = repos.chatSessions.create({
      profileId: ids.profileId,
      category: "career",
      title: "Antiga",
      provider: "mock",
      model: "sonnet",
    });
    const m = repos.chatMessages.add({
      sessionId: s.id,
      turnIndex: 0,
      role: "assistant",
      contentMd: "oi",
      toolCalls: [],
      usage: null,
    });
    repos.chatSessions.markRead(s.id, m.id);
    expect(migrate(db).applied).toContain("0011_global_chat");
    const after = createRepos(db);
    expect(after.chatSessions.get(s.id)).toMatchObject({
      profileId: ids.profileId,
      title: "Antiga",
      unread: 0,
    });
    expect(after.chatMessages.list(s.id)).toHaveLength(1);
  });

  it("conversa sem perfil e categoria job; apagar o perfil mantém a conversa", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const ids = seedFixture(repos, "engineer");
    const global = repos.chatSessions.create({
      profileId: null,
      category: "job",
      title: "Nubank - Backend Engineer",
      provider: "mock",
      model: "sonnet",
    });
    expect(global).toMatchObject({ profileId: null, category: "job" });
    const tied = repos.chatSessions.create({
      profileId: ids.profileId,
      category: "career",
      title: "Com perfil",
      provider: "mock",
      model: "sonnet",
    });
    db.prepare("delete from profile where id = ?").run(ids.profileId);
    expect(repos.chatSessions.get(tied.id)?.profileId).toBeNull();
    expect(
      repos.chatSessions
        .list()
        .map((s) => s.id)
        .sort(),
    ).toEqual([global.id, tied.id].sort());
  });
});
