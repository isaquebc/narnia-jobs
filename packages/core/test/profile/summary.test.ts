import { describe, expect, it } from "vitest";
import { buildObjectiveSummary, type SummaryExperience } from "../../src/profile/summary";
import { PROFILE_FIXTURES } from "../../src/testing/profile-fixtures";

const NOW = new Date("2026-10-08T12:00:00Z");

const engineer = (): SummaryExperience[] =>
  PROFILE_FIXTURES.engineer.experiences.map(({ achievements: _a, ...e }) => e);

describe("F02/M2 profile/summary · resumo objetivo (§2.2 item 2)", () => {
  it("anos totais com sobreposição descontada, nº de empresas e áreas", () => {
    const lines = buildObjectiveSummary({ experiences: engineer(), skills: [] }, NOW);
    // 2014-02 → 2026-10 contínuo ≈ 12,7 anos → "13 anos"
    expect(lines[0]).toMatch(/13 anos de carreira/);
    expect(lines[0]).toMatch(/6 empresas/);
    expect(lines[0]).toMatch(/software/);
  });

  it("experiência sem data parseável conta à parte como 'sem data' e não entra nos anos", () => {
    const exps: SummaryExperience[] = [
      { company: "A", title: "Dev", startDate: "2020-01", endDate: "2021-12", isCurrent: false },
      { company: "B", title: "Dev Pleno", isCurrent: false },
    ];
    const lines = buildObjectiveSummary({ experiences: exps }, NOW);
    expect(lines[0]).toMatch(/2 anos/);
    expect(lines[0]).toMatch(/1 sem data/);
  });

  it("sobreposição não conta em dobro", () => {
    const exps: SummaryExperience[] = [
      { company: "A", title: "Dev", startDate: "2020-01", endDate: "2022-12", isCurrent: false },
      { company: "B", title: "Dev", startDate: "2021-01", endDate: "2022-12", isCurrent: false },
    ];
    expect(buildObjectiveSummary({ experiences: exps }, NOW)[0]).toMatch(/3 anos/);
  });

  it("arco de cargos em ordem cronológica, do primeiro ao atual", () => {
    const lines = buildObjectiveSummary({ experiences: engineer() }, NOW);
    const arc = lines[1] as string;
    expect(arc).toMatch(/^Trajetória: /);
    expect(arc.indexOf("Estagiária de Desenvolvimento")).toBeGreaterThan(-1);
    expect(arc.indexOf("Estagiária de Desenvolvimento")).toBeLessThan(
      arc.indexOf("Engenheira de Software Sênior"),
    );
    expect(arc).toContain(" → ");
  });

  it("nível atual e domínios recorrentes (tecnologias mais frequentes nas experiências)", () => {
    const lines = buildObjectiveSummary({ experiences: engineer() }, NOW);
    expect(lines[2]).toMatch(/Nível atual: s[eê]nior/i);
    expect(lines[2]).toMatch(/Python/);
    expect(lines[2]).toMatch(/PostgreSQL/);
  });

  it("nunca passa de 3 linhas e é determinístico; sem experiências devolve uma linha", () => {
    const a = buildObjectiveSummary({ experiences: engineer() }, NOW);
    const b = buildObjectiveSummary({ experiences: engineer() }, NOW);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(3);
    const long = PROFILE_FIXTURES.long.experiences.map(({ achievements: _a, ...e }) => e);
    expect(buildObjectiveSummary({ experiences: long }, NOW).length).toBeLessThanOrEqual(3);
    expect(buildObjectiveSummary({ experiences: [] }, NOW)).toEqual([
      "Sem experiências registradas.",
    ]);
  });
});
