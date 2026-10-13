import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, type Repos } from "../src/db";
import { existingFacts, reconcileProposals } from "../src/ingest/reconcile";
import { claimOf } from "../src/ingest/review-check";
import { buildProfileCard, type CardUser } from "../src/profile/card";
import { collectFactSets, scoreFacts } from "../src/profile/relevance";
import { seedFixture } from "../src/testing/profile-fixtures";

/** Campos novos da experiência no core: reconciliação, revisor anti-alucinação e cartão (trajetória salarial). */
const NOW = new Date("2026-10-13T12:00:00Z");

function repos(): Repos {
  const db = openDatabase(":memory:");
  migrate(db);
  return createRepos(db);
}

describe("experiência com salário no core", () => {
  it("reingestão de experiência já conhecida traz salário, carga, contrato e benefícios como campos a atualizar", () => {
    const r = repos();
    const e = r.facts.experiences.insert({
      company: "Acme Ltda",
      title: "Engenheira de Software",
      startDate: "2021",
      endDate: "2023",
      isCurrent: false,
      tech: [],
      benefits: ["health_plan"],
      confidence: 1,
      verified: true,
    });
    const [m] = reconcileProposals(
      [
        {
          index: 0,
          proposal: {
            kind: "experience",
            confidence: 0.9,
            data: {
              company: "Acme",
              title: "Engenheira de Software",
              startDate: "2021",
              endDate: "2023",
              isCurrent: false,
              tech: [],
              employmentType: "pj",
              weeklyHours: 30,
              compensation: { amount: 95, period: "hourly", currency: "BRL" },
              benefits: ["gym"],
            },
          },
        },
      ],
      existingFacts(r),
      NOW,
    );
    expect(m?.match).toBe("conflict");
    expect(m?.targetId).toBe(e.id);
    const fields = Object.fromEntries(
      (m?.conflict?.fields ?? []).map((f) => [f.field, [f.current, f.proposed]]),
    );
    expect(fields).toEqual({
      employmentType: [undefined, "pj"],
      weeklyHours: [undefined, 30],
      compensation: [undefined, { amount: 95, period: "hourly", currency: "BRL" }],
      // benefícios somam com os que já estavam (aceitar não apaga o plano de saúde)
      benefits: [["health_plan"], ["health_plan", "gym"]],
    });
  });

  it("mesma remuneração e benefícios já contidos não viram conflito", () => {
    const r = repos();
    r.facts.experiences.insert({
      company: "Acme",
      title: "Dev",
      startDate: "2021",
      isCurrent: true,
      tech: [],
      compensation: { amount: 12000, period: "monthly", currency: "BRL" },
      benefits: ["health_plan", "gym"],
      confidence: 1,
      verified: true,
    });
    const [m] = reconcileProposals(
      [
        {
          index: 0,
          proposal: {
            kind: "experience",
            confidence: 0.9,
            data: {
              company: "Acme",
              title: "Dev",
              startDate: "2021",
              isCurrent: true,
              tech: [],
              compensation: { amount: 12000, period: "monthly", currency: "BRL" },
              benefits: ["gym"],
            },
          },
        },
      ],
      existingFacts(r),
      NOW,
    );
    expect(m?.match).toBe("existing");
  });

  it("o revisor anti-alucinação confere também o salário e a carga horária", () => {
    expect(
      claimOf({
        kind: "experience",
        confidence: 1,
        data: {
          company: "Acme",
          title: "Dev",
          startDate: "2021",
          isCurrent: true,
          tech: [],
          employmentType: "pj",
          weeklyHours: 30,
          compensation: { amount: 95, period: "hourly", currency: "BRL" },
          benefits: ["health_plan"],
        },
      }),
    ).toBe(
      "experiência: Dev em Acme (2021–atual); PJ, 30 h/semana; salário R$ 95,00/hora (≈ R$ 12.350,00/mês com 30 h/semana); benefícios: Plano de saúde",
    );
  });

  it("cartão: contrato e carga na linha da experiência e a trajetória do equivalente mensal", () => {
    const r = repos();
    const ids = seedFixture(r, "engineer");
    const [acme, globex] = r.facts.experiences.list();
    if (!acme || !globex) throw new Error("fixture sem duas experiências");
    r.facts.experiences.update(globex.id, {
      employmentType: "clt",
      weeklyHours: 40,
      compensation: { amount: 8000, period: "monthly", currency: "BRL" },
    });
    r.facts.experiences.update(acme.id, {
      employmentType: "pj",
      weeklyHours: 30,
      compensation: { amount: 95, period: "hourly", currency: "BRL" },
    });
    const profile = r.profiles.get(ids.profileId) as NonNullable<
      ReturnType<Repos["profiles"]["get"]>
    >;
    const facts = collectFactSets(r);
    const emphasis = r.emphasis.list(ids.profileId);
    const card = buildProfileCard(
      r.users.get() as CardUser,
      profile,
      facts,
      emphasis,
      scoreFacts(profile, facts, emphasis, NOW),
      NOW,
    );
    expect(card.text).toContain(`${acme.company} · ${acme.title}`);
    expect(card.text).toMatch(/· PJ, 30 h\/semana/);
    expect(card.text).toContain(
      `Remuneração (equivalente mensal): ${globex.company} R$ 8.000,00 → ${acme.company} R$ 12.350,00 (+54%)`,
    );
  });
});
