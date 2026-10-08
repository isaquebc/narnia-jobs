import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { isCardValid } from "../../src/profile/cards";
import { ProfileError } from "../../src/profile/errors";
import { createProfileTools, PROFILE_TOOL_NAMES } from "../../src/profile/tools";
import { seedFixture } from "../../src/testing/profile-fixtures";

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const ids = seedFixture(r, "engineer");
  return { r, ids, tools: createProfileTools(r) };
}

const valid = (r: ReturnType<typeof createRepos>, id: string) =>
  isCardValid(
    r.profiles.get(id) as NonNullable<ReturnType<typeof r.profiles.get>>,
    r.settings.getFactsVersion(),
  );

describe("F02/M2 profile/tools · handlers das tools profile.* (§2.8)", () => {
  it("expõe as seis tools e cada handler valida a entrada pelo schema", () => {
    const { tools } = setup();
    expect(Object.keys(tools).sort()).toEqual([...PROFILE_TOOL_NAMES].sort());
    expect(() => tools["profile.switch"]({})).toThrow(ZodError);
    expect(() =>
      tools["profile.update_emphasis"]({ profileId: "x", items: [{ kind: "nope" }] }),
    ).toThrow(ZodError);
  });

  it("profile.list: sem arquivados por padrão, com includeArchived lista todos e marca archived", () => {
    const { r, ids, tools } = setup();
    const created = tools["profile.create"]({
      name: "PM",
      targetTitle: "Project Manager",
      seniority: "senior",
      area: "produto",
      goal: "career_change",
      market: "BR",
      docLocale: "pt-BR",
    });
    r.profiles.archive(created.id);
    expect(tools["profile.list"]({}).profiles.map((p) => p.id)).toEqual([ids.profileId]);
    const all = tools["profile.list"]({ includeArchived: true }).profiles;
    expect(all.map((p) => [p.id, p.archived, p.isActive])).toEqual([
      [ids.profileId, false, true],
      [created.id, true, false],
    ]);
  });

  it("profile.get_card: padrão é o ativo, reconstrói se inválido e devolve só os campos do schema", () => {
    const { r, ids, tools } = setup();
    const out = tools["profile.get_card"]({});
    expect(out.profileId).toBe(ids.profileId);
    expect(out.text).toContain("Resumo:");
    expect(Object.keys(out).sort()).toEqual(["builtAt", "hash", "profileId", "text", "tokensEst"]);
    expect(valid(r, ids.profileId)).toBe(true);
    expect(tools["profile.get_card"]({ profileId: ids.profileId }).hash).toBe(out.hash);
  });

  it("profile.switch troca o ativo; em perfil arquivado lança ProfileError profile_archived", () => {
    const { r, ids, tools } = setup();
    const pm = tools["profile.create"]({
      name: "PM",
      targetTitle: "Project Manager",
      seniority: "senior",
      area: "produto",
      goal: "career_change",
      market: "BR",
      docLocale: "pt-BR",
    });
    expect(tools["profile.switch"]({ profileId: pm.id })).toEqual({ ok: true });
    expect(r.profiles.active()?.id).toBe(pm.id);
    tools["profile.switch"]({ profileId: ids.profileId });
    r.profiles.archive(pm.id);
    try {
      tools["profile.switch"]({ profileId: pm.id });
      expect.fail("devia lançar");
    } catch (e) {
      expect(e).toBeInstanceOf(ProfileError);
      expect((e as ProfileError).code).toBe("profile_archived");
    }
  });

  it("profile.update_emphasis e profile.update_pitch gravam e invalidam o cartão", () => {
    const { r, ids, tools } = setup();
    tools["profile.get_card"]({});
    expect(valid(r, ids.profileId)).toBe(true);
    const res = tools["profile.update_emphasis"]({
      profileId: ids.profileId,
      items: [
        { kind: "skill", id: ids.skillIds[0] as string, mode: "hidden" },
        { kind: "experience", id: ids.experienceIds[1] as string, mode: "highlight", position: 0 },
      ],
    });
    expect(res).toEqual({ updated: 2 });
    expect(valid(r, ids.profileId)).toBe(false);
    tools["profile.get_card"]({});
    expect(tools["profile.update_pitch"]({ profileId: ids.profileId, pitch: "Olá" })).toEqual({
      ok: true,
    });
    expect(r.profiles.get(ids.profileId)?.pitch).toBe("Olá");
    expect(valid(r, ids.profileId)).toBe(false);
  });

  it("profile.create sem cloneFrom: inativo, carreira toda em needsResearch; com cloneFrom copia ênfases, pitch e persona", () => {
    const { r, ids, tools } = setup();
    r.profiles.update(ids.profileId, { pitch: "Pitch da origem" });
    r.profiles.updatePersonaOverrides(ids.profileId, { tone: "cordial" });
    const plain = tools["profile.create"]({
      name: "PM",
      targetTitle: "Project Manager",
      seniority: "senior",
      area: "produto",
      goal: "career_change",
      market: "BR",
      docLocale: "pt-BR",
    });
    const p = r.profiles.get(plain.id);
    expect(p?.isActive).toBe(false);
    expect(p?.needsResearch.sort()).toEqual([
      "availableFrom",
      "contractTypes",
      "locations",
      "salary",
    ]);
    expect(p?.pitch ?? null).toBeNull();
    const cloned = tools["profile.create"]({
      name: "Staff",
      targetTitle: "Staff Engineer",
      seniority: "staff",
      area: "software",
      goal: "new_job",
      market: "BR",
      docLocale: "pt-BR",
      cloneFrom: ids.profileId,
    });
    const c = r.profiles.get(cloned.id);
    expect(c?.clonedFrom).toBe(ids.profileId);
    expect(c?.pitch).toBe("Pitch da origem");
    expect(c?.personaOverrides).toEqual({ tone: "cordial" });
    expect(r.emphasis.list(cloned.id).length).toBe(r.emphasis.list(ids.profileId).length);
    expect(c?.needsResearch.length).toBe(4);
  });
});
