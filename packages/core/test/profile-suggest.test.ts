import { describe, expect, it } from "vitest";
import { suggestProfile } from "../src/profile/suggest";

const NOW = new Date("2026-10-07T00:00:00Z");

describe("profile/suggest (heurística do passo 5, F01 §6.2)", () => {
  it("7 anos de backend → sênior, área software, cargo-alvo derivado do último título", () => {
    const s = suggestProfile(
      {
        experiences: [
          {
            title: "Engenheira de Software Sênior",
            startDate: "2021-03",
            endDate: "2023-11",
            isCurrent: false,
            tech: ["Go", "Kubernetes"],
          },
          {
            title: "Desenvolvedora Pleno",
            startDate: "2018-01",
            endDate: "2021-02",
            isCurrent: false,
            tech: ["Python"],
          },
          {
            title: "Engenheira de Software Sênior",
            startDate: "2024-01",
            isCurrent: true,
            tech: ["Go"],
          },
        ],
        skills: [
          { name: "Go", category: "language" },
          { name: "Kubernetes", category: "infra" },
        ],
      },
      NOW,
    );
    expect(s.seniority).toBe("senior");
    expect(s.area).toBe("software");
    expect(s.targetTitle).toMatch(/Engenheir[ao] de Software/);
    expect(s.yearsOfExperience).toBeGreaterThanOrEqual(7);
    expect(s.yearsOfExperience).toBeLessThan(9.5);
    expect(s.reason).toContain("anos");
  });

  it("1 ano → júnior; sem experiências → júnior com motivo explícito", () => {
    const one = suggestProfile(
      {
        experiences: [{ title: "Desenvolvedor", startDate: "2025-09", isCurrent: true, tech: [] }],
        skills: [],
      },
      NOW,
    );
    expect(one.seniority).toBe("junior");
    const none = suggestProfile({ experiences: [], skills: [] }, NOW);
    expect(none.seniority).toBe("junior");
    expect(none.reason).toMatch(/sem experiências/i);
  });

  it("títulos de gestão → área management e senioridade manager; 10+ anos técnicos → staff", () => {
    const pm = suggestProfile(
      {
        experiences: [
          { title: "Gerente de Projetos", startDate: "2019-01", isCurrent: true, tech: [] },
          {
            title: "Analista de Sistemas",
            startDate: "2015-01",
            endDate: "2018-12",
            isCurrent: false,
            tech: [],
          },
        ],
        skills: [{ name: "Scrum", category: "management" }],
      },
      NOW,
    );
    expect(pm.area).toBe("management");
    expect(pm.seniority).toBe("manager");
    expect(pm.targetTitle).toBe("Gerente de Projetos");
    const staff = suggestProfile(
      {
        experiences: [
          { title: "Backend Engineer", startDate: "2014-01", isCurrent: true, tech: ["Go"] },
        ],
        skills: [],
      },
      NOW,
    );
    expect(staff.seniority).toBe("staff");
    expect(staff.altTitles.length).toBeGreaterThan(0);
  });

  it("períodos sobrepostos não contam em dobro", () => {
    const s = suggestProfile(
      {
        experiences: [
          { title: "Dev", startDate: "2020-01", endDate: "2022-12", isCurrent: false, tech: [] },
          {
            title: "Dev freelancer",
            startDate: "2021-01",
            endDate: "2022-12",
            isCurrent: false,
            tech: [],
          },
        ],
        skills: [],
      },
      NOW,
    );
    expect(s.yearsOfExperience).toBeCloseTo(3, 0);
  });
});
