import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, type Repos } from "../../src/db";
import { collectFactSets, scoreFacts } from "../../src/profile/relevance";
import { seedFixture } from "../../src/testing/profile-fixtures";

const NOW = new Date("2026-10-08T12:00:00Z");

function setup(): { r: Repos; ids: ReturnType<typeof seedFixture> } {
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  return { r, ids: seedFixture(r, "engineer") };
}

const profile = { targetTitle: "Senior Backend Engineer", altTitles: [], area: "software" };

describe("F02/M2 profile/relevance · scoreFacts (§2.3)", () => {
  it("cobre todos os fatos, com nota em [0, 1], determinística", () => {
    const { r } = setup();
    const facts = collectFactSets(r);
    const a = scoreFacts(profile, facts, [], NOW);
    const b = scoreFacts(profile, facts, [], NOW);
    expect(a).toEqual(b);
    const total =
      facts.experiences.length +
      facts.achievements.length +
      facts.projects.length +
      facts.education.length +
      facts.skills.length +
      facts.languages.length;
    expect(a).toHaveLength(total);
    for (const s of a) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
    }
  });

  it("hidden → excluído (nota 0, hidden: true, motivo 'hidden'); highlight sobe a nota", () => {
    const { r, ids } = setup();
    const facts = collectFactSets(r);
    const [s1, s2] = [ids.skillIds[1] as string, ids.skillIds[2] as string];
    const scored = scoreFacts(
      profile,
      facts,
      [
        { factKind: "skill", factId: s1, mode: "hidden" },
        { factKind: "skill", factId: s2, mode: "highlight" },
      ],
      NOW,
    );
    const hidden = scored.find((s) => s.factId === s1);
    const high = scored.find((s) => s.factId === s2);
    const base = scoreFacts(profile, facts, [], NOW);
    expect(hidden).toMatchObject({ score: 0, hidden: true });
    expect(hidden?.reasons).toContain("hidden");
    expect(high?.score).toBeGreaterThan(base.find((s) => s.factId === s2)?.score as number);
    expect(high?.reasons).toContain("highlight");
  });

  it("recência aumenta a nota: experiência atual > experiência de 2014", () => {
    const { r, ids } = setup();
    const scored = scoreFacts(profile, collectFactSets(r), [], NOW);
    const current = scored.find((s) => s.factId === ids.experienceIds[0]);
    const oldest = scored.find((s) => s.factId === ids.experienceIds[5]);
    expect(current?.score).toBeGreaterThan(oldest?.score as number);
    expect(current?.reasons).toContain("recent");
  });

  it("métrica na conquista aumenta a nota; conquista herda a recência da experiência", () => {
    const { r } = setup();
    const facts = collectFactSets(r);
    const withMetric = facts.achievements.find((a) => a.metric)?.id as string;
    const without = facts.achievements.find((a) => !a.metric)?.id as string;
    const scored = scoreFacts(profile, facts, [], NOW);
    const m = scored.find((s) => s.factId === withMetric);
    expect(m?.reasons).toContain("metric");
    expect(scored.find((s) => s.factId === without)?.reasons).not.toContain("metric");
    // conquista da experiência atual tem o mesmo componente de recência que a experiência
    expect(m?.reasons).toContain("recent");
  });

  it("termos do alvo (targetTitle/altTitles/area) aumentam a nota e aparecem nos motivos", () => {
    const { r, ids } = setup();
    const facts = collectFactSets(r);
    const backendExp = ids.experienceIds[3] as string; // "Desenvolvedora Backend"
    const neutral = scoreFacts(
      { targetTitle: "Gerente", altTitles: [], area: "x" },
      facts,
      [],
      NOW,
    );
    const targeted = scoreFacts(profile, facts, [], NOW);
    expect(targeted.find((s) => s.factId === backendExp)?.score).toBeGreaterThan(
      neutral.find((s) => s.factId === backendExp)?.score as number,
    );
    expect(targeted.find((s) => s.factId === backendExp)?.reasons).toContain("target_match");
  });

  it("skill herda a recência da experiência mais recente em que aparece no tech", () => {
    const { r } = setup();
    const facts = collectFactSets(r);
    const ts = facts.skills.find((s) => s.name === "TypeScript")?.id as string; // atual
    const go = facts.skills.find((s) => s.name === "Go")?.id as string; // em nenhuma experiência
    const scored = scoreFacts({ targetTitle: "Gerente", altTitles: [], area: "x" }, facts, [], NOW);
    expect(scored.find((s) => s.factId === ts)?.score).toBeGreaterThan(
      scored.find((s) => s.factId === go)?.score as number,
    );
    expect(scored.find((s) => s.factId === ts)?.reasons).toContain("recent");
  });

  it("verificado conta como motivo", () => {
    const { r } = setup();
    const scored = scoreFacts(profile, collectFactSets(r), [], NOW);
    expect(scored.every((s) => s.reasons.includes("verified"))).toBe(true);
  });
});
