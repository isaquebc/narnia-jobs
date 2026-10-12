import { describe, expect, it } from "vitest";
import { cardUpdatedNote, PromptTemplateError, renderNote } from "../../src/chat/prompt";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { seedFixture } from "../../src/testing/profile-fixtures";

/** F04/M3 · peças do core para as sessões: remover sessão e notas de turno (texto só em packages/, varredura do M2). */
describe("F04/M3 core", () => {
  it("chatSessions.remove apaga a sessão e, em cascata, as mensagens", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const ids = seedFixture(repos, "engineer");
    const s = repos.chatSessions.create({
      profileId: ids.profileId,
      category: "career",
      title: "Carreira",
      provider: "mock",
      model: "sonnet",
    });
    repos.chatMessages.add({
      sessionId: s.id,
      turnIndex: 0,
      role: "user",
      contentMd: "oi",
      toolCalls: [],
      usage: null,
    });
    repos.chatSessions.remove(s.id);
    expect(repos.chatSessions.get(s.id)).toBeNull();
    expect(repos.chatMessages.list(s.id)).toEqual([]);
  });

  it("nota de cartão atualizado traz o cartão novo; contexto da clarificação traz a execução", () => {
    expect(cardUpdatedNote("Ana · Backend sênior")).toMatch(
      /cartão do perfil foi atualizado[\s\S]*Ana · Backend sênior/i,
    );
  });

  it("renderNote preenche os placeholders do texto do plugin e recusa placeholder sem valor (auditoria E2, 19c)", () => {
    expect(renderNote("clarifica {{run_id}} com ingest_propose\n", { run_id: "run-123" })).toBe(
      "clarifica run-123 com ingest_propose",
    );
    expect(() => renderNote("sem {{valor}}", {})).toThrow(PromptTemplateError);
  });
});
