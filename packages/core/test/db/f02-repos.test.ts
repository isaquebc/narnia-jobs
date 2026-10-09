import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, type Repos } from "../../src/db";
import { ProfileError } from "../../src/profile/errors";
import { seedFixture } from "../../src/testing/profile-fixtures";

function setup(): Repos {
  const db = openDatabase(":memory:");
  migrate(db);
  return createRepos(db);
}

const PM = {
  name: "Project Manager",
  targetTitle: "Project Manager",
  altTitles: [],
  seniority: "senior" as const,
  area: "produto",
  goal: "career_change" as const,
  market: "BR",
  docLocale: "pt-BR",
  needsResearch: ["salary", "contractTypes", "locations", "availableFrom"] as Array<
    "salary" | "contractTypes" | "locations" | "availableFrom"
  >,
};

describe("F02/M1 repos/profiles estendido", () => {
  it("list exclui arquivados por padrão e inclui com includeArchived", () => {
    const r = setup();
    const { profileId } = seedFixture(r, "engineer");
    const pm = r.profiles.create({ ...PM, userId: r.users.ensureId(), isActive: false });
    r.profiles.archive(pm.id);
    expect(r.profiles.list().map((p) => p.id)).toEqual([profileId]);
    expect(r.profiles.list({ includeArchived: true }).map((p) => p.id)).toEqual([profileId, pm.id]);
    expect(r.profiles.get(pm.id)?.archivedAt).toMatch(/Z$/);
  });

  it("archive do ativo → profile_active; setActive de arquivado → profile_archived; unarchive volta", () => {
    const r = setup();
    const { profileId } = seedFixture(r, "engineer");
    const pm = r.profiles.create({ ...PM, userId: r.users.ensureId(), isActive: false });
    expect(() => r.profiles.archive(profileId)).toThrow(ProfileError);
    try {
      r.profiles.archive(profileId);
    } catch (e) {
      expect((e as ProfileError).code).toBe("profile_active");
    }
    r.profiles.archive(pm.id);
    expect(() => r.profiles.setActive(pm.id)).toThrow(/arquivado/);
    expect(() => r.profiles.archive(pm.id)).toThrow(ProfileError);
    r.profiles.unarchive(pm.id);
    expect(r.profiles.get(pm.id)?.archivedAt).toBeNull();
    r.profiles.setActive(pm.id);
    expect(r.profiles.active()?.id).toBe(pm.id);
    expect(() => r.profiles.archive("nope")).toThrow(ProfileError);
  });

  it("clone copia ênfases, pitch e overrides; não copia carreira; preenche clonedFrom; nasce inativo", () => {
    const r = setup();
    const { profileId, experienceIds, skillIds } = seedFixture(r, "engineer");
    r.profiles.update(profileId, { pitch: "Construo plataformas que escalam." });
    r.profiles.updatePersonaOverrides(profileId, { tone: "cordial" });
    r.emphasis.replace(profileId, [
      { kind: "experience", id: experienceIds[0] as string, mode: "highlight", position: 0 },
      { kind: "skill", id: skillIds[0] as string, mode: "hidden" },
    ]);
    const clone = r.profiles.clone(profileId, {
      ...PM,
      name: "Staff Engineer",
      targetTitle: "Staff Engineer",
    });
    expect(clone.clonedFrom).toBe(profileId);
    expect(clone.isActive).toBe(false);
    expect(clone.pitch).toBe("Construo plataformas que escalam.");
    expect(clone.personaOverrides).toEqual({ tone: "cordial" });
    expect(clone.salary).toBeUndefined();
    expect(clone.needsResearch).toEqual(PM.needsResearch);
    const copied = r.emphasis.list(clone.id);
    expect(copied.map((e) => [e.factKind, e.factId, e.mode])).toEqual([
      ["experience", experienceIds[0], "highlight"],
      ["skill", skillIds[0], "hidden"],
    ]);
    expect(r.emphasis.list(profileId)).toHaveLength(2);
  });

  it("updatePersonaOverrides mescla, null apaga a chave e rejeita valor fora do enum", () => {
    const r = setup();
    const { profileId } = seedFixture(r, "engineer");
    r.profiles.updatePersonaOverrides(profileId, { tone: "cordial", rigor: "medio" });
    r.profiles.updatePersonaOverrides(profileId, { rigor: null, market: "US" });
    expect(r.profiles.get(profileId)?.personaOverrides).toEqual({ tone: "cordial", market: "US" });
    expect(() =>
      r.profiles.updatePersonaOverrides(profileId, { tone: "bravo" as never }),
    ).toThrow();
  });

  it("cartão: setCard grava cache + cardFactsVersion; update de pitch/ênfases invalidam só o próprio (persona não); invalidateCards devolve os que viraram", () => {
    const r = setup();
    const { profileId, skillIds } = seedFixture(r, "engineer");
    const pm = r.profiles.create({ ...PM, userId: r.users.ensureId(), isActive: false });
    const card = {
      text: "cartão",
      tokensEst: 2,
      hash: "h1",
      factsVersion: r.settings.getFactsVersion(),
      builtAt: "2026-10-08T12:00:00.000Z",
    };
    r.profiles.setCard(profileId, card);
    r.profiles.setCard(pm.id, { ...card, hash: "h2" });
    expect(r.profiles.get(profileId)?.cardUpdatedAt).toBe(card.builtAt);
    expect(r.profiles.get(profileId)?.cardFactsVersion).toBe(card.factsVersion);
    expect(JSON.parse(r.profiles.get(profileId)?.cardJson ?? "{}")).toMatchObject({ hash: "h1" });

    r.profiles.update(pm.id, { pitch: "novo" });
    expect(r.profiles.get(pm.id)?.cardUpdatedAt).toBeNull();
    expect(r.profiles.get(profileId)?.cardUpdatedAt).toBe(card.builtAt);

    r.profiles.setCard(pm.id, { ...card, hash: "h3" });
    r.emphasis.replace(pm.id, [{ kind: "skill", id: skillIds[1] as string, mode: "highlight" }]);
    expect(r.profiles.get(pm.id)?.cardUpdatedAt).toBeNull();

    r.profiles.setCard(pm.id, { ...card, hash: "h4" });
    r.profiles.updatePersonaOverrides(pm.id, { tone: "cordial" });
    // a persona não entra no cartão: não invalida (auditoria F02-5, 2026-10-08)
    expect(r.profiles.get(pm.id)?.cardUpdatedAt).not.toBeNull();

    r.profiles.setCard(pm.id, { ...card, hash: "h5" });
    const flipped = r.profiles.invalidateCards(r.users.ensureId());
    expect(flipped.sort()).toEqual([pm.id, profileId].sort());
    expect(r.profiles.invalidateCards(r.users.ensureId())).toEqual([]);
    expect(r.profiles.invalidateCard(profileId)).toBe(false);
  });
});

describe("F02/M1 repos/emphasis", () => {
  it("replace substitui o conjunto e renumera position sem buracos por tipo, respeitando a ordem pedida", () => {
    const r = setup();
    const { profileId, experienceIds, skillIds } = seedFixture(r, "engineer");
    const [e0, e1, e2] = experienceIds as [string, string, string];
    expect(
      r.emphasis.replace(profileId, [
        { kind: "experience", id: e2, mode: "highlight", position: 7 },
        { kind: "experience", id: e0, mode: "normal", position: 2 },
        { kind: "experience", id: e1, mode: "hidden" },
        { kind: "skill", id: skillIds[0] as string, mode: "highlight", position: 5 },
      ]).updated,
    ).toBe(4);
    const rows = r.emphasis.list(profileId);
    expect(
      rows.filter((x) => x.factKind === "experience").map((x) => [x.factId, x.position]),
    ).toEqual([
      [e0, 0],
      [e2, 1],
      [e1, 2],
    ]);
    expect(rows.find((x) => x.factKind === "skill")?.position).toBe(0);
    expect(
      r.emphasis.replace(profileId, [{ kind: "skill", id: skillIds[1] as string, mode: "hidden" }])
        .updated,
    ).toBe(1);
    expect(r.emphasis.list(profileId).map((x) => x.factId)).toEqual([skillIds[1]]);
    expect(r.emphasis.countByMode(profileId)).toEqual({ highlighted: 0, hidden: 1 });
  });

  it("rejeita fato inexistente, fato de outro usuário e perfil inexistente, sem gravar nada", () => {
    const r = setup();
    const { profileId, experienceIds } = seedFixture(r, "engineer");
    const before = r.emphasis.list(profileId);
    expect(before).toHaveLength(2); // ênfases iniciais da fixture
    expect(() =>
      r.emphasis.replace(profileId, [{ kind: "experience", id: "nope", mode: "normal" }]),
    ).toThrow(ProfileError);
    try {
      r.emphasis.replace(profileId, [
        { kind: "experience", id: experienceIds[0] as string, mode: "normal" },
        { kind: "skill", id: "nope", mode: "normal" },
      ]);
    } catch (e) {
      expect((e as ProfileError).code).toBe("fact_not_found");
    }
    expect(r.emphasis.list(profileId)).toEqual(before);
    // fato de outro usuário: forjado direto no banco, sem FK (usuário único em F01, mas a regra fica)
    r.db.exec("pragma foreign_keys = off");
    r.db
      .prepare(
        "insert into skill (id, user_id, name, name_normalized, category, confidence, verified, created_at, updated_at) values ('alien', 'outro', 'Go', 'go', 'language', 1, 1, 'x', 'x')",
      )
      .run();
    r.db.exec("pragma foreign_keys = on");
    try {
      r.emphasis.replace(profileId, [{ kind: "skill", id: "alien", mode: "normal" }]);
      expect.unreachable();
    } catch (e) {
      expect((e as ProfileError).code).toBe("fact_foreign");
    }
    expect(r.emphasis.list(profileId)).toEqual(before);
    expect(() => r.emphasis.replace("nope", [])).toThrow(/não encontrado/);
  });

  it("aceita achievement (via experiência) e project (tabela vazia de F02-9)", () => {
    const r = setup();
    const { profileId, achievementIds, projectIds } = seedFixture(r, "engineer");
    r.emphasis.replace(profileId, [
      { kind: "achievement", id: achievementIds[0] as string, mode: "highlight" },
      { kind: "project", id: projectIds[0] as string, mode: "hidden" },
    ]);
    expect(r.emphasis.list(profileId).map((x) => x.factKind)).toEqual(["achievement", "project"]);
  });

  it("facts.remove apaga ênfase e relevância do fato (hook onRemove)", () => {
    const r = setup();
    const { profileId, skillIds } = seedFixture(r, "engineer");
    const sid = skillIds[0] as string;
    r.emphasis.replace(profileId, [{ kind: "skill", id: sid, mode: "highlight" }]);
    r.relevance.replaceForProfile(profileId, [
      { factKind: "skill", factId: sid, score: 0.9, reasons: ["highlight"] },
    ]);
    r.facts.skills.remove(sid);
    expect(r.emphasis.list(profileId)).toEqual([]);
    expect(r.relevance.listByProfile(profileId)).toEqual([]);
  });
});

describe("F02/M1 repos/relevance", () => {
  it("replaceForProfile substitui o conjunto do perfil e grava computedAt em UTC", () => {
    const r = setup();
    const { profileId, skillIds, experienceIds } = seedFixture(r, "engineer");
    r.relevance.replaceForProfile(profileId, [
      { factKind: "skill", factId: skillIds[0] as string, score: 0.4, reasons: [] },
    ]);
    const n = r.relevance.replaceForProfile(profileId, [
      { factKind: "experience", factId: experienceIds[0] as string, score: 1, reasons: ["recent"] },
      { factKind: "skill", factId: skillIds[1] as string, score: 0.5, reasons: ["target"] },
    ]);
    expect(n).toBe(2);
    const rows = r.relevance.listByProfile(profileId);
    expect(rows.map((x) => x.factId)).toEqual([experienceIds[0], skillIds[1]]);
    expect(rows[0]?.computedAt).toMatch(/Z$/);
    expect(rows[1]?.reasons).toEqual(["target"]);
    r.relevance.clearProfile(profileId);
    expect(r.relevance.listByProfile(profileId)).toEqual([]);
  });
});

describe("F02/M1 repos/suggestions", () => {
  const payload = {
    title: "Engineering Manager",
    seniority: "manager" as const,
    area: "software",
    market: "BR",
    rationale: "3 anos liderando squads",
    supportingFactIds: ["x"],
  };
  it("create grava com source/model, dedupe por título normalizado em qualquer status", () => {
    const r = setup();
    seedFixture(r, "engineer");
    const a = r.suggestions.create({ source: "heuristic", payload });
    expect(a?.status).toBe("new");
    expect(a?.model).toBeNull();
    expect(
      r.suggestions.create({
        source: "model",
        model: "sonnet",
        payload: { ...payload, title: "  engineering   manager " },
      }),
    ).toBeNull();
    expect(r.suggestions.hasTitle("ENGINEERING MANAGER")).toBe(true);
    const b = r.suggestions.create({
      source: "model",
      model: "sonnet",
      payload: { ...payload, title: "Staff Engineer" },
    });
    expect(b?.model).toBe("sonnet");
    expect(r.suggestions.list().map((s) => s.payload.title)).toEqual([
      "Engineering Manager",
      "Staff Engineer",
    ]);
  });
  it("dismiss e accept gravam status e decidedAt; dismissedTitles lista normalizados; filtro por status", () => {
    const r = setup();
    seedFixture(r, "engineer");
    const a = r.suggestions.create({ source: "heuristic", payload });
    const b = r.suggestions.create({
      source: "heuristic",
      payload: { ...payload, title: "Head of Engineering" },
    });
    const d = r.suggestions.dismiss(a?.id as string);
    expect(d.status).toBe("dismissed");
    expect(d.decidedAt).toMatch(/Z$/);
    expect(r.suggestions.accept(b?.id as string).status).toBe("accepted");
    expect(r.suggestions.dismissedTitles()).toEqual(["engineering manager"]);
    expect(r.suggestions.list({ status: "new" })).toEqual([]);
    expect(() => r.suggestions.dismiss("nope")).toThrow(/não encontrada/);
  });
});

describe("F02/M1 repos/facts.projects (F02-9)", () => {
  it("insere, lista, atualiza, conta e remove projetos pela fábrica, incrementando facts_version", () => {
    const r = setup();
    r.users.upsert({ fullName: "Ana Maria Exemplo" });
    const v0 = r.settings.getFactsVersion();
    const p = r.facts.projects.insert({
      name: "narnia-jobs",
      description: "Agente recrutador local",
      url: "https://example.com/narnia",
      tech: ["TypeScript", "SQLite"],
      confidence: 0.9,
      verified: false,
    });
    expect(p.tech).toEqual(["TypeScript", "SQLite"]);
    expect(r.settings.getFactsVersion()).toBe(v0 + 1);
    expect(r.facts.projects.update(p.id, { role: "autora", verified: true }).role).toBe("autora");
    expect(r.facts.counts().projects).toBe(1);
    expect(r.facts.projects.list()).toHaveLength(1);
    r.facts.projects.remove(p.id);
    expect(r.facts.projects.get(p.id)).toBeNull();
    expect(r.settings.getFactsVersion()).toBe(v0 + 3);
  });
});
