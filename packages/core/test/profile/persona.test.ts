import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { buildPersona } from "../../src/profile/persona";
import { type FixtureName, seedFixture } from "../../src/testing/profile-fixtures";

function profileOf(name: FixtureName) {
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const ids = seedFixture(r, name);
  return {
    r,
    id: ids.profileId,
    profile: r.profiles.get(ids.profileId) as NonNullable<ReturnType<typeof r.profiles.get>>,
  };
}

describe("F02/M2 profile/persona · buildPersona (§2.4, F02-7)", () => {
  it("derivação padrão nas três fixtures: tom direto, honestidade máxima, rigor alto, recrutador sênior", () => {
    for (const name of ["engineer", "leader", "long"] as const) {
      const { profile } = profileOf(name);
      const p = buildPersona(profile);
      expect(p).toMatchObject({
        tone: "direto",
        honesty: "maxima",
        rigor: "alto",
        recruiterSeniority: "senior",
        targetLevel: profile.seniority,
        market: profile.market,
        language: profile.docLocale,
      });
      expect(p.specialty).toBe(`${profile.area} · ${profile.targetTitle}`);
    }
  });

  it("overrides sobrepõem só os campos informados e só valores do enum; null restaura", () => {
    const { r, id } = profileOf("engineer");
    r.profiles.updatePersonaOverrides(id, { tone: "cordial", specialty: "Pagamentos" });
    let p = buildPersona(r.profiles.get(id) as NonNullable<ReturnType<typeof r.profiles.get>>);
    expect(p.tone).toBe("cordial");
    expect(p.specialty).toBe("Pagamentos");
    expect(p.rigor).toBe("alto");
    r.profiles.updatePersonaOverrides(id, { tone: null });
    p = buildPersona(r.profiles.get(id) as NonNullable<ReturnType<typeof r.profiles.get>>);
    expect(p.tone).toBe("direto");
    expect(p.specialty).toBe("Pagamentos");
    expect(() => r.profiles.updatePersonaOverrides(id, { rigor: "baixo" as "alto" })).toThrow();
  });

  it("aceita overrides passados por fora (perfil sem overrides gravados)", () => {
    const { profile } = profileOf("leader");
    const p = buildPersona({ ...profile, personaOverrides: {} }, { recruiterSeniority: "pleno" });
    expect(p.recruiterSeniority).toBe("pleno");
  });
});
