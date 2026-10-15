import { PreAnalysisSchema } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { buildPreAnalysis, postingRisks } from "../../src/postings/match";
import { seedFixture } from "../../src/testing/profile-fixtures";
import { JD_EN, JD_PT } from "./fixtures";

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  const ids = seedFixture(repos, "engineer");
  return { repos, ids };
}

/** F06/M3 · busca local das keywords nos fatos e riscos por perfil (sem tokens). */
describe("F06/M3 core · pré-análise", () => {
  it("keywords obrigatórias com evidência nos fatos (dicionário e sinônimos); cobertura calculada", () => {
    const { repos, ids } = setup();
    const { preAnalysis } = buildPreAnalysis(repos, JD_EN);
    expect(PreAnalysisSchema.parse(preAnalysis)).toBeTruthy();
    const pg = preAnalysis.keywords.find((k) => k.term === "PostgreSQL");
    expect(pg?.evidence.length).toBeGreaterThan(0);
    expect(pg?.evidence[0]?.kind).toMatch(/skill|experience|project/);
    // a fixture não tem Rust: sem evidência, sem inventar
    expect(preAnalysis.keywords.find((k) => k.term === "Rust")?.evidence).toEqual([]);
    expect(preAnalysis.coverage).toBeGreaterThan(0);
    expect(preAnalysis.coverage).toBeLessThanOrEqual(1);
    expect(Object.keys(preAnalysis.risksByProfile)).toEqual([ids.profileId]);
    expect(preAnalysis.keywords.every((k) => k.source === "heuristic")).toBe(true);
  });

  it("riscos: híbrida em São Paulo para perfil só remoto; CLT fora dos contratos; faixa abaixo do mínimo", () => {
    const profile = {
      seniority: "senior" as const,
      contractTypes: ["pj" as const],
      locations: [{ country: "BR", city: "Campinas", remote: "remote" as const }],
      salary: { min: 25000, max: 30000, currency: "BRL", period: "monthly" as const },
    };
    const risks = postingRisks(
      {
        workMode: "hybrid",
        city: "São Paulo",
        state: "SP",
        contractType: "clt",
        currency: "BRL",
        salaryMin: 15000,
        salaryMax: 20000,
        salaryPeriod: "monthly",
        seniority: "junior",
      },
      profile,
      { remotePref: "remote", relocation: { mode: "none", countries: [] }, city: "Campinas" },
      { requiresEnglish: true, speaksEnglish: false },
    );
    expect(risks.map((r) => r.type).sort()).toEqual(
      ["contract", "language", "salary", "seniority", "work_mode"].sort(),
    );
  });

  it("presencial na cidade do usuário não é risco de local; moeda diferente não compara salário", () => {
    const risks = postingRisks(
      { workMode: "onsite", city: "Campinas", currency: "USD", salaryMax: 1000 },
      {
        seniority: "senior",
        contractTypes: [],
        locations: [{ country: "BR", city: "Campinas", remote: "any" }],
        salary: { min: 18000, max: 25000, currency: "BRL", period: "monthly" },
      },
      { remotePref: "any", relocation: { mode: "none", countries: [] }, city: "Campinas" },
    );
    expect(risks).toEqual([]);
  });

  it("vaga em pt-BR: contrato CLT casa com o perfil da fixture", () => {
    const { repos, ids } = setup();
    const { preAnalysis, fields } = buildPreAnalysis(repos, JD_PT);
    expect(fields.contractType).toBe("clt");
    expect(preAnalysis.risksByProfile[ids.profileId]?.some((r) => r.type === "contract")).toBe(
      false,
    );
  });
});
