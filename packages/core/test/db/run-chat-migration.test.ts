import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { seedFixture } from "../../src/testing/profile-fixtures";

/** Migration 0009: a execução guarda a conversa que a abriu e marca o aviso do fim uma vez só. */
describe("migration 0009_run_chat_session", () => {
  it("upgrade preserva as execuções; ligar à conversa e reservar o aviso uma vez", () => {
    const db = openDatabase(":memory:");
    migrate(db, { until: "0008_check_reason" });
    const repos = createRepos(db);
    repos.users.ensureId();
    const file = repos.sourceFiles.insert({
      mime: "text/plain",
      size: 1,
      sha256: "s",
      path: "p",
      kind: "text",
    });
    const run = repos.ingestionRuns.create({
      fileId: file.id,
      provider: "mock",
      models: { document: "h", facts: "h", digest: "s" },
      options: { ocr: false, modelRead: false },
    });
    expect(migrate(db, { until: "0009_run_chat_session" }).applied).toEqual([
      "0009_run_chat_session",
    ]);
    const after = createRepos(db);
    expect(after.ingestionRuns.get(run.id)?.chatSessionId).toBeNull();
    const ids = seedFixture(after, "engineer");
    const s = after.chatSessions.create({
      profileId: ids.profileId,
      category: "career",
      title: "A",
      provider: "mock",
      model: "sonnet",
    });
    after.ingestionRuns.linkChat(run.id, s.id);
    expect(after.ingestionRuns.get(run.id)?.chatSessionId).toBe(s.id);
    expect(after.ingestionRuns.claimChatNotice(run.id)).toBe(true);
    expect(after.ingestionRuns.claimChatNotice(run.id)).toBe(false);
  });
});
