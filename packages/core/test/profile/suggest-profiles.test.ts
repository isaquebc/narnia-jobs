import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { collectFactSets } from "../../src/profile/relevance";
import { refreshHeuristicSuggestions, suggestProfiles } from "../../src/profile/suggest";
import { type FixtureName, seedFixture } from "../../src/testing/profile-fixtures";

const NOW = new Date("2026-10-08T12:00:00Z");

function setup(name: FixtureName) {
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const ids = seedFixture(r, name);
  return { r, ids, facts: collectFactSets(r) };
}

describe("F02/M2 profile/suggest · suggestProfiles (§2.6, F02-5 heurística)", () => {
  it("fixture leader sugere Engineering Manager e Project Manager com fatos de apoio e justificativa", () => {
    const { facts } = setup("leader");
    const out = suggestProfiles(
      facts,
      { existingTitles: [], dismissedTitles: [], market: "BR" },
      NOW,
    );
    const titles = out.map((s) => s.title);
    expect(titles).toContain("Engineering Manager");
    expect(titles).toContain("Project Manager");
    expect(out.length).toBeLessThanOrEqual(3);
    for (const s of out) {
      expect(s.supportingFactIds.length).toBeGreaterThan(0);
      expect(s.rationale).toMatch(/\S/);
      expect(s.market).toBe("BR");
      expect(s.area).toMatch(/\S/);
    }
    const em = out.find((s) => s.title === "Engineering Manager");
    expect(em?.seniority).toBe("manager");
    expect(em?.supportingFactIds).toContain(
      facts.experiences.find((e) => e.title === "Engineering Manager")?.id,
    );
  });

  it("engineer sem liderança → nenhuma sugestão; determinístico", () => {
    const { facts } = setup("engineer");
    const out = suggestProfiles(
      facts,
      { existingTitles: [], dismissedTitles: [], market: "BR" },
      NOW,
    );
    expect(out).toEqual([]);
  });

  it("não repete perfil existente nem título dispensado (comparação normalizada)", () => {
    const { facts } = setup("leader");
    const out = suggestProfiles(
      facts,
      {
        existingTitles: ["  engineering   MANAGER "],
        dismissedTitles: ["project manager"],
        market: "BR",
      },
      NOW,
    );
    expect(out.map((s) => s.title)).not.toContain("Engineering Manager");
    expect(out.map((s) => s.title)).not.toContain("Project Manager");
  });

  it("refreshHeuristicSuggestions grava as novas com source heuristic, sem duplicar e respeitando dispensadas", () => {
    const { r } = setup("leader");
    const created = refreshHeuristicSuggestions(r, NOW);
    expect(created.length).toBeGreaterThanOrEqual(2);
    expect(created.every((s) => s.source === "heuristic")).toBe(true);
    expect(refreshHeuristicSuggestions(r, NOW)).toEqual([]);
    const pm = r.suggestions.list().find((s) => s.payload.title === "Project Manager");
    r.suggestions.dismiss((pm as NonNullable<typeof pm>).id);
    expect(refreshHeuristicSuggestions(r, NOW)).toEqual([]);
    expect(r.suggestions.list({ status: "new" }).map((s) => s.payload.title)).not.toContain(
      "Project Manager",
    );
  });
});
