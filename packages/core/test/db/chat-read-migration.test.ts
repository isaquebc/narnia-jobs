import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { seedFixture } from "../../src/testing/profile-fixtures";

/** Migration 0010: marca de leitura por conversa (ponto verde no menu, 2026-10-13). */
describe("migration 0010_chat_read", () => {
  it("conversas que já existiam começam lidas; mensagem nova do recrutador conta como não lida", () => {
    const db = openDatabase(":memory:");
    migrate(db, { until: "0009_run_chat_session" });
    const repos = createRepos(db);
    const ids = seedFixture(repos, "engineer");
    const s = repos.chatSessions.create({
      profileId: ids.profileId,
      category: "career",
      title: "Antiga",
      provider: "mock",
      model: "sonnet",
    });
    const msg = (role: "user" | "assistant" | "system_note", turnIndex: number) =>
      repos.chatMessages.add({
        sessionId: s.id,
        turnIndex,
        role,
        contentMd: role,
        toolCalls: [],
        usage: null,
      });
    msg("user", 0);
    msg("assistant", 0);
    expect(migrate(db, { until: "0010_chat_read" }).applied).toEqual(["0010_chat_read"]);
    const after = createRepos(db);
    expect(after.chatSessions.get(s.id)?.unread).toBe(0);
    const reply = after.chatMessages.add({
      sessionId: s.id,
      turnIndex: 1,
      role: "assistant",
      contentMd: "nova",
      toolCalls: [],
      usage: null,
    });
    after.chatMessages.add({
      sessionId: s.id,
      turnIndex: 2,
      role: "user",
      contentMd: "minha",
      toolCalls: [],
      usage: null,
    });
    // as do usuário não contam
    expect(after.chatSessions.get(s.id)?.unread).toBe(1);
    expect(after.chatSessions.list({ profileId: ids.profileId })[0]?.unread).toBe(1);
    expect(after.chatSessions.markRead(s.id, reply.id)).toBe(true);
    expect(after.chatSessions.get(s.id)?.unread).toBe(0);
  });

  it("a marca só avança e só aceita mensagem da própria conversa", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const ids = seedFixture(repos, "engineer");
    const mk = (title: string) =>
      repos.chatSessions.create({
        profileId: ids.profileId,
        category: "career",
        title,
        provider: "mock",
        model: "sonnet",
      });
    const a = mk("A");
    const b = mk("B");
    const add = (sessionId: string, contentMd: string) =>
      repos.chatMessages.add({
        sessionId,
        turnIndex: 0,
        role: "assistant",
        contentMd,
        toolCalls: [],
        usage: null,
      });
    const first = add(a.id, "1");
    const second = add(a.id, "2");
    const other = add(b.id, "x");
    // conversa nova, nada lido ainda: as duas respostas contam
    expect(repos.chatSessions.get(a.id)?.unread).toBe(2);
    expect(repos.chatSessions.markRead(a.id, other.id)).toBe(false);
    expect(repos.chatSessions.markRead(a.id, second.id)).toBe(true);
    expect(repos.chatSessions.markRead(a.id, first.id)).toBe(false);
    expect(repos.chatSessions.get(a.id)?.unread).toBe(0);
    expect(repos.chatSessions.get(b.id)?.unread).toBe(1);
  });
});
