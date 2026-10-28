import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { createPostingTools } from "../../src/postings/tools";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * F07/M1.6: o motivo de arquivar uma vaga ("não deu um bom fit") alimenta o fit. O `posting_get`, que o recrutador
 * especializado lê antes de dar o fit, traz as vagas que o usuário descartou com o motivo e a nota, mais recentes primeiro.
 */
function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  seedFixture(r, "engineer");
  const posting = (company: string, title: string) =>
    r.postings.create({ company, title }, { source: "user" });
  const tools = createPostingTools(r, {
    ports: { intake: async () => ({ ok: false, code: "x", message: "x" }) },
  });
  return { r, posting, tools };
}

describe("F07/M1.6 · vagas descartadas no posting_get", () => {
  it("traz as arquivadas com motivo e nota, mais recentes primeiro, sem a própria vaga", async () => {
    const { r, posting, tools } = setup();
    const target = posting("Nova", "Backend Sr");
    const a = posting("Acme", "Backend Pleno");
    const b = posting("Beta", "Frontend");
    posting("Gama", "Dados");
    r.postings.setArchived(
      a.id,
      { reason: "salary", note: "Abaixo do meu piso" },
      new Date("2026-10-20T00:00:00Z"),
    );
    r.postings.setArchived(b.id, { reason: "stack", note: null }, new Date("2026-10-25T00:00:00Z"));
    const got = await tools["posting.get"]({ id: target.id });
    expect(got.discarded).toEqual([
      {
        id: b.id,
        line: expect.stringContaining("Beta"),
        reason: "stack",
        note: null,
        archivedOn: "2026-10-25",
      },
      {
        id: a.id,
        line: expect.stringContaining("Acme"),
        reason: "salary",
        note: "Abaixo do meu piso",
        archivedOn: "2026-10-20",
      },
    ]);
    const self = await tools["posting.get"]({ id: a.id });
    expect(self.discarded.map((d) => d.id)).toEqual([b.id]);
  });

  it("no máximo 10 e nenhuma quando não há arquivadas", async () => {
    const { r, posting, tools } = setup();
    const target = posting("Nova", "Backend");
    expect((await tools["posting.get"]({ id: target.id })).discarded).toEqual([]);
    for (let i = 0; i < 12; i++) {
      const p = posting(`E${i}`, "Backend");
      r.postings.setArchived(
        p.id,
        { reason: "other", note: null },
        new Date(Date.UTC(2026, 9, i + 1)),
      );
    }
    const got = await tools["posting.get"]({ id: target.id });
    expect(got.discarded).toHaveLength(10);
    expect(got.discarded[0]?.line).toContain("E11");
  });
});
