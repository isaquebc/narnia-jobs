import { PROFILE_CARD_MAX_CHARS } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, type Repos } from "../../src/db";
import { buildProfileCard, type CardUser } from "../../src/profile/card";
import { collectFactSets, scoreFacts } from "../../src/profile/relevance";
import { type FixtureName, seedFixture } from "../../src/testing/profile-fixtures";

const NOW = new Date("2026-10-08T12:00:00Z");

function build(name: FixtureName, patch: Record<string, unknown> = {}) {
  const db = openDatabase(":memory:");
  migrate(db);
  const r: Repos = createRepos(db);
  const ids = seedFixture(r, name);
  const profile = {
    ...(r.profiles.get(ids.profileId) as NonNullable<ReturnType<Repos["profiles"]["get"]>>),
    ...patch,
  };
  const user = r.users.get() as CardUser;
  const facts = collectFactSets(r);
  const emphasis = r.emphasis.list(ids.profileId);
  const relevance = scoreFacts(profile, facts, emphasis, NOW);
  return {
    r,
    ids,
    profile,
    user,
    facts,
    emphasis,
    relevance,
    card: buildProfileCard(user, profile, facts, emphasis, relevance, NOW),
  };
}

describe("F02/M2 profile/card · buildProfileCard (§2.2)", () => {
  it("seções na ordem: identidade, resumo objetivo, alvo, carreira, pitch, experiências, skills, lacunas", () => {
    const { card } = build("engineer", { pitch: "Construo plataformas de pagamento confiáveis." });
    const t = card.text;
    const idx = (s: string) => {
      const i = t.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    const order = [
      idx("Ana Maria Exemplo"),
      idx("Resumo:"),
      idx("Alvo:"),
      idx("Carreira:"),
      idx("Pitch:"),
      idx("Experiências:"),
      idx("Skills:"),
      idx("Lacunas:"),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(t).toContain("Campinas");
    expect(t).toMatch(/Inglês \(C1\)/);
    expect(t).toContain("Senior Backend Engineer");
  });

  it("mesmo input → mesmo hash; tokensEst = ceil(chars/4)", () => {
    const a = build("engineer");
    const b = build("engineer");
    expect(a.card.hash).toBe(b.card.hash);
    expect(a.card.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.card.tokensEst).toBe(Math.ceil(a.card.text.length / 4));
  });

  it("top-3 experiências e top-8 skills seguem a relevância; destacado vem primeiro; oculto não aparece", () => {
    const { r, ids, profile, user, facts } = build("engineer");
    const hiddenExp = ids.experienceIds[0] as string; // atual, destacada na fixture
    const goSkill = facts.skills.find((s) => s.name === "Go")?.id as string;
    r.emphasis.replace(ids.profileId, [
      { kind: "experience", id: hiddenExp, mode: "hidden" },
      { kind: "skill", id: goSkill, mode: "highlight" },
    ]);
    const emphasis = r.emphasis.list(ids.profileId);
    const relevance = scoreFacts(profile, facts, emphasis, NOW);
    const card = buildProfileCard(user, profile, facts, emphasis, relevance, NOW);
    expect(card.text).not.toContain("Acme Pagamentos");
    const skillsLine = card.text.split("\n").find((l) => l.startsWith("Skills:")) as string;
    expect(skillsLine.indexOf("Go")).toBeGreaterThan(-1);
    const names = skillsLine
      .replace("Skills:", "")
      .split(",")
      .map((s) => s.trim());
    expect(names.length).toBeLessThanOrEqual(8);
    expect(names[0]).toBe("Go");
    const expLines = card.text.split("\n").filter((l) => l.startsWith("• "));
    expect(expLines.length).toBeLessThanOrEqual(3);
    expect(expLines[0]).toContain("Beta Logística"); // a mais recente entre as visíveis
  });

  it("'a pesquisar' para cada campo em needsResearch e lacunas com fatos não verificados", () => {
    const { r, ids, user, facts, emphasis } = build("engineer");
    const profile = {
      ...(r.profiles.get(ids.profileId) as NonNullable<ReturnType<Repos["profiles"]["get"]>>),
      salary: undefined,
      contractTypes: [],
      needsResearch: ["salary", "contractTypes"] as Array<"salary" | "contractTypes">,
    };
    r.facts.skills.update(ids.skillIds[0] as string, { verified: false });
    const facts2 = collectFactSets(r);
    const relevance = scoreFacts(profile, facts2, emphasis, NOW);
    const card = buildProfileCard(user, profile, facts2, emphasis, relevance, NOW);
    expect(card.text).toMatch(/salário: a pesquisar/i);
    expect(card.text).toMatch(/contratos: a pesquisar/i);
    expect(card.text).toMatch(/Lacunas:.*1 fato não verificado/s);
    expect(card.text).toMatch(/a pesquisar com o recrutador: salário, contratos/i);
    expect(facts.skills.length).toBe(20);
  });

  it("fixture longa cabe no teto rígido e o resumo objetivo sobrevive ao corte", () => {
    const { card } = build("long");
    expect(card.text.length).toBeLessThanOrEqual(PROFILE_CARD_MAX_CHARS);
    expect(card.text).toContain("Resumo:");
    expect(card.text).toContain("Alvo:");
    expect(card.text).toContain("Carreira:");
    expect(card.text).toContain("Pitch:");
    expect(card.text.split("\n").filter((l) => l.startsWith("• ")).length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("corte segue a prioridade: lacunas saem antes das skills, skills antes das experiências", () => {
    const { user, profile, facts, emphasis, relevance } = build("engineer");
    const full = buildProfileCard(user, profile, facts, emphasis, relevance, NOW);
    const noGaps = buildProfileCard(user, profile, facts, emphasis, relevance, NOW, {
      maxChars: full.text.length - 1,
    });
    expect(noGaps.text).not.toContain("Lacunas:");
    expect(noGaps.text).toContain("Skills:");
    const fewSkills = buildProfileCard(user, profile, facts, emphasis, relevance, NOW, {
      maxChars: noGaps.text.length - 1,
    });
    const skillsLine = fewSkills.text.split("\n").find((l) => l.startsWith("Skills:")) as string;
    expect(skillsLine.split(",").length).toBeLessThanOrEqual(3);
    expect(fewSkills.text.split("\n").filter((l) => l.startsWith("• ")).length).toBe(3);
    const oneExp = buildProfileCard(user, profile, facts, emphasis, relevance, NOW, {
      maxChars: fewSkills.text.length - 1,
    });
    expect(oneExp.text.split("\n").filter((l) => l.startsWith("• ")).length).toBe(1);
    expect(oneExp.text).toContain("Resumo:");
  });
});
