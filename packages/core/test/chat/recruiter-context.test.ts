import { describe, expect, it } from "vitest";
import { recruiterContext } from "../../src/chat/recruiter-context";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { seedFixture } from "../../src/testing/profile-fixtures";

const extra = (repos: ReturnType<typeof createRepos>, userId: string, name: string) =>
  repos.profiles.create({
    name,
    targetTitle: name,
    altTitles: [],
    seniority: "senior",
    area: "gestão",
    goal: "career_change",
    market: "BR",
    docLocale: "pt-BR",
    needsResearch: ["salary", "contractTypes", "locations", "availableFrom"],
    userId,
    isActive: false,
  });

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  const ids = seedFixture(repos, "engineer");
  return { repos, ids };
}

/** F06-8 · o recrutador geral conhece todos os perfis não arquivados, não só o ativo. */
describe("F06/M1 core · recruiterContext", () => {
  it("lista todos os perfis não arquivados com id, cartão e o ativo marcado", () => {
    const { repos, ids } = setup();
    const other = extra(repos, ids.userId, "Engineering Manager");
    const ctx = recruiterContext(repos);
    expect(ctx.profileIds).toEqual(expect.arrayContaining([ids.profileId, other.id]));
    expect(ctx.text).toContain(`id ${ids.profileId}`);
    expect(ctx.text).toContain(`id ${other.id}`);
    expect(ctx.text).toContain("Engineering Manager");
    expect(ctx.text).toMatch(/perfil ativo/);
    expect(ctx.persona.language).toBe("pt-BR");
  });

  it("arquivado fica fora; o hash muda quando um cartão muda", () => {
    const { repos, ids } = setup();
    const before = recruiterContext(repos);
    const other = extra(repos, ids.userId, "Arquivável");
    const withOther = recruiterContext(repos);
    expect(withOther.hash).not.toBe(before.hash);
    repos.profiles.archive(other.id);
    const after = recruiterContext(repos);
    expect(after.profileIds).not.toContain(other.id);
    expect(after.hash).toBe(before.hash);
  });

  it("sem nenhum perfil devolve texto explicando e persona padrão", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const ctx = recruiterContext(createRepos(db));
    expect(ctx.profileIds).toEqual([]);
    expect(ctx.text).toMatch(/nenhum perfil/i);
    expect(ctx.persona.tone).toBeTruthy();
  });
});
