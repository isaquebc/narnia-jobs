import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, type Repos } from "../../src/db";
import {
  getCard,
  isCardValid,
  rebuildCard,
  trackInvalidation,
  validProfileIds,
} from "../../src/profile/cards";
import { seedFixture } from "../../src/testing/profile-fixtures";

function setup(name: "engineer" | "leader" = "engineer") {
  const db = openDatabase(":memory:");
  migrate(db);
  const r: Repos = createRepos(db);
  const ids = seedFixture(r, name);
  return { r, ids };
}

const META = { confidence: 1, verified: true };

describe("F02/M2 profile/cards · validade, reconstrução e invalidação (§2.2, §2.9-2)", () => {
  it("cartão nasce inválido; getCard reconstrói, grava cache + relevância e passa a ser válido", () => {
    const { r, ids } = setup();
    const before = r.profiles.get(ids.profileId);
    expect(isCardValid(before as NonNullable<typeof before>, r.settings.getFactsVersion())).toBe(
      false,
    );
    const card = getCard(r, ids.profileId);
    expect(card.text).toContain("Resumo:");
    expect(card.builtAt).toMatch(/Z$/);
    expect(card.factsVersion).toBe(r.settings.getFactsVersion());
    const after = r.profiles.get(ids.profileId) as NonNullable<typeof before>;
    expect(isCardValid(after, r.settings.getFactsVersion())).toBe(true);
    expect(JSON.parse(after.cardJson as string)).toEqual(card);
    expect(after.cardFactsVersion).toBe(card.factsVersion);
    expect(r.relevance.listByProfile(ids.profileId).length).toBeGreaterThan(20);
    // leitura seguinte vem do cache (mesmo builtAt)
    expect(getCard(r, ids.profileId).builtAt).toBe(card.builtAt);
  });

  it("escrever em cada tabela de fatos (via repos) invalida o cartão por facts_version", () => {
    const { r, ids } = setup();
    const writes: Array<[string, () => void]> = [
      [
        "experience",
        () => r.facts.experiences.update(ids.experienceIds[0] as string, { title: "X" }),
      ],
      [
        "achievement",
        () => r.facts.achievements.update(ids.achievementIds[0] as string, { text: "Y" }),
      ],
      ["education", () => r.facts.education.update(ids.educationIds[0] as string, { course: "Z" })],
      ["skill", () => r.facts.skills.insert({ name: "Nova", category: "tool", ...META })],
      ["language", () => r.facts.languages.insert({ name: "Espanhol", level: "B1", ...META })],
      ["project", () => r.facts.projects.insert({ name: "Proj", tech: [], ...META })],
    ];
    for (const [label, write] of writes) {
      getCard(r, ids.profileId);
      const valid = () =>
        isCardValid(
          r.profiles.get(ids.profileId) as NonNullable<ReturnType<Repos["profiles"]["get"]>>,
          r.settings.getFactsVersion(),
        );
      expect(valid(), `${label}: válido antes`).toBe(true);
      write();
      expect(valid(), `${label}: inválido depois`).toBe(false);
    }
  });

  it("users.upsert, profiles.update, emphasis.replace, clone e archive invalidam", () => {
    const { r, ids } = setup();
    const valid = (id = ids.profileId) =>
      isCardValid(
        r.profiles.get(id) as NonNullable<ReturnType<Repos["profiles"]["get"]>>,
        r.settings.getFactsVersion(),
      );
    getCard(r, ids.profileId);
    r.users.upsert({ city: "São Paulo" });
    expect(valid()).toBe(false);
    getCard(r, ids.profileId);
    r.profiles.update(ids.profileId, { pitch: "Novo pitch" });
    expect(valid()).toBe(false);
    getCard(r, ids.profileId);
    r.emphasis.replace(ids.profileId, [
      { kind: "skill", id: ids.skillIds[0] as string, mode: "highlight" },
    ]);
    expect(valid()).toBe(false);
    getCard(r, ids.profileId);
    const clone = r.profiles.clone(ids.profileId, {
      name: "Clone",
      targetTitle: "Staff Engineer",
      altTitles: [],
      seniority: "staff",
      area: "software",
      goal: "new_job",
      market: "BR",
      docLocale: "pt-BR",
      needsResearch: ["salary", "contractTypes", "locations", "availableFrom"],
    });
    expect(valid(clone.id)).toBe(false);
    getCard(r, clone.id);
    r.profiles.archive(clone.id);
    expect(valid(clone.id)).toBe(false);
  });

  it("trackInvalidation devolve só os perfis que estavam válidos e viraram inválidos (16 aceites = 1 evento)", () => {
    const { r, ids } = setup();
    const other = r.profiles.create({
      name: "PM",
      targetTitle: "Project Manager",
      altTitles: [],
      seniority: "senior",
      area: "produto",
      goal: "career_change",
      market: "BR",
      docLocale: "pt-BR",
      needsResearch: ["salary", "contractTypes", "locations", "availableFrom"],
      userId: ids.userId,
      isActive: false,
    });
    getCard(r, ids.profileId);
    expect(validProfileIds(r)).toEqual([ids.profileId]);
    getCard(r, other.id);
    expect(validProfileIds(r).sort()).toEqual([ids.profileId, other.id].sort());
    const { result, flipped } = trackInvalidation(r, () => {
      for (let i = 0; i < 16; i += 1) {
        r.facts.skills.insert({ name: `S${i}`, category: "tool", ...META });
      }
      return "ok";
    });
    expect(result).toBe("ok");
    expect(flipped.sort()).toEqual([ids.profileId, other.id].sort());
    // já inválidos: nova escrita não "vira" nada
    expect(
      trackInvalidation(r, () => r.facts.skills.insert({ name: "T", category: "tool", ...META }))
        .flipped,
    ).toEqual([]);
    // sem escrita: nada vira
    getCard(r, ids.profileId);
    expect(trackInvalidation(r, () => 1).flipped).toEqual([]);
  });

  it("rebuildCard força a reconstrução mesmo com cartão válido", async () => {
    const { r, ids } = setup();
    const a = getCard(r, ids.profileId);
    await new Promise((res) => setTimeout(res, 5));
    const b = rebuildCard(r, ids.profileId);
    expect(b.hash).toBe(a.hash);
    expect(b.builtAt >= a.builtAt).toBe(true);
    expect(b.builtAt).not.toBe(a.builtAt);
  });

  it("perfil inexistente → ProfileError profile_not_found", () => {
    const { r } = setup();
    expect(() => getCard(r, "nope")).toThrow(/não encontrado/);
  });
});
