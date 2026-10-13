import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";

/**
 * Migration 0007 (campos novos da experiência, pedido do dono 2026-10-13): colunas aditivas para carga horária,
 * salário (valor, período, moeda) e benefícios. Upgrade de um banco 0006 com experiência gravada preserva tudo.
 */
describe("migration 0007_experience_compensation", () => {
  it("upgrade preserva a experiência antiga; os campos novos gravam e voltam", () => {
    const db = openDatabase(":memory:");
    migrate(db, { until: "0006_chat_discovery" });
    db.exec(
      "insert into user (id, created_at, updated_at) values ('u1', '2026-01-01', '2026-01-01')",
    );
    db.exec(
      `insert into experience (id, user_id, company, title, employment_type, start_date, is_current, tech_json, created_at, updated_at)
       values ('e1', 'u1', 'Acme', 'Engenheira', 'clt', '2021', 0, '["Go"]', '2026-01-01', '2026-01-01')`,
    );
    expect(migrate(db, { until: "0007_experience_compensation" }).applied).toEqual([
      "0007_experience_compensation",
    ]);
    const repos = createRepos(db);
    const old = repos.facts.experiences.get("e1");
    expect(old).toMatchObject({ company: "Acme", employmentType: "clt", tech: ["Go"] });
    expect(old).not.toHaveProperty("compensation");
    expect(old).not.toHaveProperty("weeklyHours");
    repos.facts.experiences.update("e1", {
      weeklyHours: 30,
      compensation: { amount: 95, period: "hourly", currency: "BRL" },
      benefits: ["health_plan", "gym"],
      benefitsOther: ["auxílio creche"],
    });
    expect(repos.facts.experiences.get("e1")).toMatchObject({
      employmentType: "clt",
      weeklyHours: 30,
      compensation: { amount: 95, period: "hourly", currency: "BRL" },
      benefits: ["health_plan", "gym"],
      benefitsOther: ["auxílio creche"],
    });
    const created = repos.facts.experiences.insert({
      company: "Globex",
      title: "Dev",
      employmentType: "pj",
      startDate: "2018",
      isCurrent: false,
      tech: [],
      weeklyHours: 44,
      compensation: { amount: 8000, period: "monthly", currency: "BRL" },
      confidence: 1,
      verified: true,
    });
    expect(repos.facts.experiences.get(created.id)).toMatchObject({
      weeklyHours: 44,
      compensation: { amount: 8000, period: "monthly", currency: "BRL" },
      benefits: [],
    });
    expect(db.prepare("pragma foreign_key_check").all()).toEqual([]);
  });
});
