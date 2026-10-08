import type { SalaryReference } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { isBelowReference } from "../src/salary";

const ref: SalaryReference = {
  id: "ref-1",
  country: "BR",
  source: "dieese",
  indicator: "salario_minimo_necessario",
  value: 7200.5,
  currency: "BRL",
  period: "monthly",
  referenceMonth: "2026-09",
  sourceUrl: "https://www.dieese.org.br/analisecestabasica/salarioMinimo.html",
  fetchedAt: "2026-10-07T12:00:00.000Z",
  isCurrent: true,
};

describe("salary/isBelowReference (F01-15, piso DIEESE)", () => {
  it("compara BRL mensal diretamente", () => {
    expect(isBelowReference(6000, "BRL", "monthly", ref)).toBe(true);
    expect(isBelowReference(7200.5, "BRL", "monthly", ref)).toBe(false);
    expect(isBelowReference(9000, "BRL", "monthly", ref)).toBe(false);
  });
  it("normaliza anual para mensal (÷ 12)", () => {
    expect(isBelowReference(72000, "BRL", "yearly", ref)).toBe(true);
    expect(isBelowReference(120000, "BRL", "yearly", ref)).toBe(false);
  });
  it("devolve null para outras moedas, período horário ou sem referência", () => {
    expect(isBelowReference(1000, "USD", "monthly", ref)).toBeNull();
    expect(isBelowReference(30, "BRL", "hourly", ref)).toBeNull();
    expect(isBelowReference(1000, "BRL", "monthly", null)).toBeNull();
  });
});
