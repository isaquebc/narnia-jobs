import { describe, expect, it } from "vitest";
import {
  BENEFIT_LABELS,
  BENEFITS,
  CONTRACT_TYPE_LABELS,
  compensationEquivalents,
  compensationTrajectory,
  ExperienceDataSchema,
  formatCompensation,
} from "../src/index";

/**
 * Campos novos da experiência (pedido do dono, 2026-10-13): tipo de contrato e carga horária separados, salário com
 * valor, período e moeda, benefícios de uma lista e "outros" livres. Todos opcionais.
 */
const base = {
  company: "Acme",
  title: "Engenheira",
  startDate: "2021",
  isCurrent: false,
  tech: [],
};

describe("experiência: contrato, carga horária, salário e benefícios", () => {
  it("campos opcionais validados; experiência antiga continua válida", () => {
    expect(ExperienceDataSchema.parse(base)).toEqual(base);
    const full = {
      ...base,
      employmentType: "pj",
      weeklyHours: 30,
      compensation: { amount: 95, period: "hourly", currency: "BRL" },
      benefits: ["health_plan", "gym"],
      benefitsOther: ["auxílio creche"],
    };
    expect(ExperienceDataSchema.parse(full)).toEqual(full);
    expect(() => ExperienceDataSchema.parse({ ...base, weeklyHours: 0 })).toThrow();
    expect(() => ExperienceDataSchema.parse({ ...base, weeklyHours: 120 })).toThrow();
    expect(() =>
      ExperienceDataSchema.parse({
        ...base,
        compensation: { amount: -1, period: "monthly", currency: "BRL" },
      }),
    ).toThrow();
    expect(() => ExperienceDataSchema.parse({ ...base, benefits: ["iate"] })).toThrow();
  });

  it("lista de benefícios aprovada pelo dono, com rótulos em pt-BR", () => {
    expect(BENEFITS).toEqual([
      "meal_voucher",
      "health_plan",
      "dental_plan",
      "life_insurance",
      "transport_voucher",
      "home_office_allowance",
      "profit_sharing",
      "equity",
      "thirteenth_salary",
      "paid_vacation",
      "education_allowance",
      "private_pension",
      "gym",
      "birthday_day_off",
    ]);
    expect(BENEFIT_LABELS.meal_voucher).toBe("Vale-refeição/alimentação");
    expect(BENEFIT_LABELS.gym).toBe("Academia (Gympass/Wellhub)");
    expect(CONTRACT_TYPE_LABELS.pj).toBe("PJ");
  });

  it("equivalentes: por hora vira mês e ano pela carga semanal; sem carga, só o que dá para saber", () => {
    expect(compensationEquivalents({ amount: 100, period: "hourly", currency: "BRL" }, 30)).toEqual(
      {
        hourly: 100,
        monthly: 13000,
        yearly: 156000,
      },
    );
    expect(
      compensationEquivalents({ amount: 12000, period: "monthly", currency: "BRL" }, 40),
    ).toEqual({
      hourly: 69.23,
      monthly: 12000,
      yearly: 144000,
    });
    expect(compensationEquivalents({ amount: 120000, period: "yearly", currency: "USD" })).toEqual({
      hourly: null,
      monthly: 10000,
      yearly: 120000,
    });
    expect(compensationEquivalents({ amount: 100, period: "hourly", currency: "BRL" })).toEqual({
      hourly: 100,
      monthly: null,
      yearly: null,
    });
  });

  it("formatCompensation descreve valor, período, moeda e o equivalente mensal", () => {
    expect(formatCompensation({ amount: 100, period: "hourly", currency: "BRL" }, 30)).toBe(
      "R$ 100,00/hora (≈ R$ 13.000,00/mês com 30 h/semana)",
    );
    expect(formatCompensation({ amount: 12000, period: "monthly", currency: "BRL" })).toBe(
      "R$ 12.000,00/mês",
    );
  });

  it("trajetória: em ordem cronológica, variação do equivalente mensal na mesma moeda", () => {
    const t = compensationTrajectory([
      {
        company: "Acme",
        startDate: "2021-03",
        compensation: { amount: 12000, period: "monthly", currency: "BRL" },
      },
      {
        company: "Globex",
        startDate: "2018",
        weeklyHours: 40,
        compensation: { amount: 50, period: "hourly", currency: "BRL" },
      },
      {
        company: "Initech",
        startDate: "2024",
        compensation: { amount: 90000, period: "yearly", currency: "USD" },
      },
      { company: "Sem salário", startDate: "2020" },
    ]);
    expect(t).toEqual([
      { company: "Globex", startDate: "2018", monthly: 8666.67, currency: "BRL", change: null },
      { company: "Acme", startDate: "2021-03", monthly: 12000, currency: "BRL", change: 0.3846 },
      { company: "Initech", startDate: "2024", monthly: 7500, currency: "USD", change: null },
    ]);
  });
});
