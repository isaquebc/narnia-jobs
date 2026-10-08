import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../src/db";
import { FIXTURE_NAMES, PROFILE_FIXTURES, seedFixture } from "../src/testing/profile-fixtures";

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  return createRepos(db);
}

describe("F02/M1 testing/profile-fixtures (compartilhadas por testes, mock e _test/seed)", () => {
  it("engineer: usuário completo, 6 experiências com conquistas e métricas, 2 projetos, 20 skills, 2 formações, 2 idiomas, perfil ativo", () => {
    const r = setup();
    const ids = seedFixture(r, "engineer");
    expect(r.users.complete().fullName).toBe("Ana Maria Exemplo");
    expect(r.facts.counts()).toMatchObject({
      experiences: 6,
      projects: 2,
      skills: 20,
      education: 2,
      languages: 2,
    });
    expect(r.facts.counts().achievements).toBeGreaterThanOrEqual(6);
    expect(r.facts.achievements.list().some((a) => a.metric)).toBe(true);
    expect(r.profiles.active()?.id).toBe(ids.profileId);
    expect(ids.experienceIds).toHaveLength(6);
    expect(r.profiles.active()?.cardUpdatedAt).toBeNull();
  });
  it("leader: fatos de liderança (títulos e skills de gestão)", () => {
    const r = setup();
    seedFixture(r, "leader");
    const titles = r.facts.experiences.list().map((e) => e.title.toLowerCase());
    expect(titles.some((t) => /manager|head|lead/.test(t))).toBe(true);
    expect(r.facts.skills.list().some((s) => s.category === "management")).toBe(true);
  });
  it("long: 20 experiências e 60 skills para o teto do cartão", () => {
    const r = setup();
    seedFixture(r, "long");
    expect(r.facts.counts().experiences).toBe(20);
    expect(r.facts.counts().skills).toBe(60);
  });
  it("nenhum dado real: nomes, e-mails e telefones fictícios; nomes das fixtures estáveis", () => {
    expect(FIXTURE_NAMES).toEqual(["engineer", "leader", "long"]);
    for (const f of Object.values(PROFILE_FIXTURES)) {
      expect(f.user.email).toMatch(/@example\.com$/);
      expect(f.user.fullName).toMatch(/Exemplo/);
    }
  });
});
