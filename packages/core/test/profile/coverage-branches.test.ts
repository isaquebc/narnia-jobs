import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, type Repos } from "../../src/db";
import { buildAnalyzeInput } from "../../src/profile/analyze-input";
import { buildProfileCard, type CardProfile, type CardUser } from "../../src/profile/card";
import { getCard, invalidateUserCards, isCardValid, parseCard } from "../../src/profile/cards";
import { buildPersona } from "../../src/profile/persona";
import { collectFactSets, scoreFacts, targetTerms } from "../../src/profile/relevance";
import { refreshHeuristicSuggestions, suggestProfiles } from "../../src/profile/suggest";
import { buildObjectiveSummary } from "../../src/profile/summary";
import { createProfileTools } from "../../src/profile/tools";
import { seedFixture } from "../../src/testing/profile-fixtures";

/** Teste depois (cobertura de ramos de `src/profile/**`, piso 80%): fallbacks, cortes profundos e caminhos vazios. */
const NOW = new Date("2026-10-08T12:00:00Z");
const META = { confidence: 0.8, verified: false };

function fresh(): Repos {
  const db = openDatabase(":memory:");
  migrate(db);
  return createRepos(db);
}

const EMPTY_USER: CardUser = {
  fullName: null,
  displayName: null,
  city: null,
  country: null,
  remotePref: null,
};

describe("F02/M2 cobertura · card.ts fallbacks e cortes profundos", () => {
  it("usuário vazio, campos de carreira não informados, rótulos desconhecidos e pitch multilinha", () => {
    const r = fresh();
    const uid = r.users.ensureId();
    const e = r.facts.experiences.insert({
      company: "Solo",
      title: "Analista",
      startDate: "2020",
      isCurrent: false,
      tech: [],
      ...META,
    });
    r.facts.achievements.insert({ experienceId: e.id, text: "Sem métrica", ...META });
    const lang = r.facts.languages.insert({ name: "Francês", level: "A2", ...META });
    const profile: CardProfile = {
      targetTitle: "Analista",
      seniority: "director" as CardProfile["seniority"],
      area: "x",
      goal: "promotion",
      market: "US",
      docLocale: "en-US",
      salary: { min: 50, max: 80, currency: "USD", period: "hourly" },
      contractTypes: ["temporary"],
      locations: [{ country: "US", remote: "hybrid" }],
      availableFrom: "2027-01-01",
      needsResearch: [],
      pitch: "linha 1\nlinha 2\nlinha 3\nlinha 4",
    };
    const facts = collectFactSets(r);
    const emphasis = [{ factKind: "language" as const, factId: lang.id, mode: "hidden" as const }];
    const card = buildProfileCard(
      EMPTY_USER,
      profile,
      facts,
      emphasis,
      scoreFacts({ ...profile, altTitles: [] }, facts, emphasis, NOW),
      NOW,
    );
    expect(card.text).toMatch(/^Usuário\n/);
    expect(card.text).not.toContain("Francês");
    expect(card.text).toContain("USD 50–80/hora");
    expect(card.text).toContain("temporário");
    expect(card.text).toContain("US híbrido");
    expect(card.text).toContain("disponibilidade: 2027-01-01");
    expect(card.text).toContain("direção");
    expect(card.text).toContain("promoção");
    expect(card.text).toContain("  linha 3");
    expect(card.text).not.toContain("linha 4");
    expect(card.text).toContain("— Sem métrica");
    expect(card.text).toMatch(/Lacunas: 3 fatos não verificados/);
    void uid;

    const none: CardProfile = {
      ...profile,
      salary: undefined,
      contractTypes: [],
      locations: [],
      availableFrom: undefined,
      pitch: null,
    };
    const card2 = buildProfileCard(
      EMPTY_USER,
      none,
      facts,
      [],
      scoreFacts({ ...none, altTitles: [] }, facts, [], NOW),
      NOW,
    );
    expect(card2.text).toContain("salário: não informado");
    expect(card2.text).toContain("contratos: não informado");
    expect(card2.text).toContain("localidades: não informado");
    expect(card2.text).toContain("disponibilidade: não informada");
    expect(card2.text).not.toContain("Pitch:");
  });

  it("corte profundo: pitch e resumo encolhem, depois skills e experiências somem, e o teto final é respeitado", () => {
    const r = fresh();
    const ids = seedFixture(r, "engineer");
    const profile = r.profiles.get(ids.profileId) as NonNullable<
      ReturnType<Repos["profiles"]["get"]>
    >;
    const facts = collectFactSets(r);
    const rel = scoreFacts(profile, facts, [], NOW);
    const user = r.users.get() as CardUser;
    const tiny = buildProfileCard(user, { ...profile, pitch: "a\nb\nc\nd" }, facts, [], rel, NOW, {
      maxChars: 500,
    });
    expect(tiny.text.length).toBeLessThanOrEqual(500);
    expect(tiny.text).not.toContain("Skills:");
    expect(tiny.text).not.toContain("Experiências:");
    expect(tiny.text).toContain("Resumo:");
  });
});

describe("F02/M2 cobertura · analyze-input com campos opcionais ausentes e sem usuário", () => {
  it("monta a entrada com repos vazios e com fatos mínimos", () => {
    const r = fresh();
    expect(buildAnalyzeInput(r).identity.name).toBe("Usuário");
    const e = r.facts.experiences.insert({
      company: "A",
      title: "Dev",
      startDate: "2021",
      isCurrent: true,
      tech: [],
      ...META,
    });
    const ach = r.facts.achievements.insert({ experienceId: e.id, text: "x", ...META });
    r.facts.education.insert({ institution: "I", course: "C", status: "in_progress", ...META });
    r.facts.skills.insert({ name: "S", category: "other", ...META });
    r.facts.projects.insert({ name: "P", tech: [], ...META });
    const f = r.sourceFiles.insert({
      mime: "text/plain",
      size: 1,
      sha256: "b".repeat(64),
      path: "t.txt",
      kind: "text",
    });
    r.digests.upsert({
      fileId: f.id,
      summary: "s",
      keyPoints: [],
      sections: [],
      meta: {},
      editedByUser: false,
    });
    const pid = r.profiles.create({
      name: "P",
      targetTitle: "T",
      altTitles: [],
      seniority: "junior",
      area: "a",
      goal: "new_job",
      market: "BR",
      docLocale: "pt-BR",
      needsResearch: ["salary", "contractTypes", "locations", "availableFrom"],
      userId: r.users.ensureId(),
      isActive: true,
    }).id;
    r.emphasis.replace(pid, [{ kind: "achievement", id: ach.id, mode: "hidden" }]);
    const input = buildAnalyzeInput(r);
    expect(input.experiences[0]?.period).toBe("2021–atual");
    expect(input.experiences[0]?.achievements).toEqual([]);
    expect(input.education[0]).toEqual({ id: expect.any(String), institution: "I", course: "C" });
    expect(input.skills[0]).toEqual({ id: expect.any(String), name: "S", category: "other" });
    expect(input.projects[0]).toEqual({ id: expect.any(String), name: "P", tech: [] });
    expect(input.digests[0]?.fileName).toBe(f.id);
  });
});

describe("F02/M2 cobertura · cards.ts cache corrompido e invalidação explícita; persona sem overrides", () => {
  it("cardJson inválido ou versão nula = cartão inválido; invalidateUserCards devolve os válidos", () => {
    const r = fresh();
    const ids = seedFixture(r, "engineer");
    getCard(r, ids.profileId);
    expect(invalidateUserCards(r)).toEqual([ids.profileId]);
    expect(invalidateUserCards(r)).toEqual([]);
    getCard(r, ids.profileId);
    r.db.prepare("update profile set card_json = ? where id = ?").run("{not json", ids.profileId);
    const broken = r.profiles.get(ids.profileId) as NonNullable<
      ReturnType<Repos["profiles"]["get"]>
    >;
    expect(parseCard(broken)).toBeNull();
    expect(isCardValid(broken, r.settings.getFactsVersion())).toBe(false);
    r.db
      .prepare("update profile set card_json = ? where id = ?")
      .run(JSON.stringify({ nope: 1 }), ids.profileId);
    expect(parseCard(r.profiles.get(ids.profileId) as typeof broken)).toBeNull();
    r.db
      .prepare(
        "update profile set card_json = null, card_facts_version = null, card_updated_at = ? where id = ?",
      )
      .run("2026-10-08T00:00:00.000Z", ids.profileId);
    expect(isCardValid(r.profiles.get(ids.profileId) as typeof broken, 0)).toBe(false);
    // reconstrução recupera
    expect(getCard(r, ids.profileId).text).toContain("Resumo:");
  });

  it("buildPersona com personaOverrides ausente e extra com null", () => {
    const p = buildPersona(
      { area: "a", targetTitle: "T", seniority: "pleno", market: "BR", docLocale: "pt-BR" },
      { tone: "cordial", rigor: null },
    );
    expect(p.tone).toBe("cordial");
    expect(p.rigor).toBe("alto");
  });
});

describe("F02/M2 cobertura · sugestões por título de PM e Tech Lead sem gestão; relevância e resumo em casos limite", () => {
  it("PM por título (seniority manager) e Tech Lead quando há liderança sem cargo de gestão", () => {
    const r = fresh();
    const lead = r.facts.experiences.insert({
      company: "A",
      title: "Tech Lead",
      startDate: "2022",
      isCurrent: true,
      tech: ["Go"],
      ...META,
    });
    const pm = r.facts.experiences.insert({
      company: "B",
      title: "Product Owner",
      startDate: "2019",
      endDate: "2021",
      isCurrent: false,
      tech: [],
      ...META,
    });
    const out = suggestProfiles(
      collectFactSets(r),
      { existingTitles: [], dismissedTitles: [], market: "US" },
      NOW,
    );
    const titles = out.map((s) => s.title);
    expect(titles).toEqual(["Engineering Manager", "Project Manager", "Tech Lead"]);
    expect(out[1]?.seniority).toBe("manager");
    expect(out[1]?.supportingFactIds).toContain(pm.id);
    expect(out[2]?.supportingFactIds).toEqual([lead.id]);
    expect(out[1]?.rationale).toContain("—");
    // sem perfil ativo o mercado cai em "BR"
    const created = refreshHeuristicSuggestions(r, NOW);
    expect(created.every((s) => s.payload.market === "BR")).toBe(true);
  });

  it("relevância: projeto encerrado, formação em andamento, skill sem experiência (recência neutra), termos com ponto", () => {
    const r = fresh();
    r.facts.projects.insert({
      name: "Proj",
      startDate: "2015",
      endDate: "2016",
      tech: ["Node.js"],
      ...META,
    });
    r.facts.education.insert({
      institution: "I",
      course: "Node.js avançado",
      status: "in_progress",
      startDate: "2026",
      ...META,
    });
    const solo = r.facts.skills.insert({ name: "Cobol", category: "language", ...META });
    r.facts.languages.insert({ name: "Alemão", level: "B2", ...META });
    const profile = {
      targetTitle: "Node.js Engineer",
      altTitles: ["Dev de Node.js"],
      area: "software",
    };
    expect(targetTerms(profile)).toEqual(["node.js", "engineer", "dev", "software"]);
    const scored = scoreFacts(profile, collectFactSets(r), [], NOW);
    const cobol = scored.find((s) => s.factId === solo.id);
    expect(cobol?.reasons).not.toContain("recent");
    expect(scored.find((s) => s.factKind === "education")?.reasons).toContain("target_match");
    expect(scored.find((s) => s.factKind === "project")?.reasons).toContain("target_match");
    expect(scored.find((s) => s.factKind === "language")?.score).toBeGreaterThan(0);
    expect(
      scoreFacts(
        { targetTitle: "de", altTitles: [], area: "e" },
        collectFactSets(r),
        [],
        NOW,
      ).every((s) => !s.reasons.includes("target_match")),
    ).toBe(true);
  });

  it("resumo: sem áreas reconhecidas omite a cláusula; mais de 5 cargos distintos vira início … fim; sem data ordena ao final", () => {
    const exps = Array.from({ length: 7 }, (_, i) => ({
      company: `C${i}`,
      title: `Cargo ${i}`,
      startDate: `${2010 + i}-01`,
      endDate: `${2010 + i}-12`,
      isCurrent: false,
    }));
    const lines = buildObjectiveSummary(
      { experiences: [...exps, { company: "X", title: "Sem período", isCurrent: false }] },
      NOW,
    );
    expect(lines[0]).not.toContain("áreas:");
    expect(lines[1]).toContain(" … ");
    expect(lines[1]).toMatch(/Sem período\.$/);
    expect(lines[2]).not.toContain("domínios");
  });

  it("tools: sem perfil ativo, get_card lança profile_not_found", () => {
    const r = fresh();
    expect(() => createProfileTools(r)["profile.get_card"]({})).toThrow(/Nenhum perfil ativo/);
  });
});
