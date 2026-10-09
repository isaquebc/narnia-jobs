import type { Budget, BudgetUnit, IngestionDepth } from "@narnia-jobs/shared";

/**
 * Divisão igual por repositório (F03-3 §2): fatia = (orçamento − reserva da síntese − reserva do revisor) / nº de
 * repositórios. Sobra de um repositório não passa para outro: nenhum ganha profundidade por causa do limite.
 */
export function splitBudget(i: {
  amount: number;
  unit: BudgetUnit;
  depth: IngestionDepth;
  repoCount: number;
  reserve: { synthesis: number; check: number };
}): Budget {
  if (!Number.isInteger(i.repoCount) || i.repoCount < 1) {
    throw new Error("A divisão do orçamento exige ao menos um repositório");
  }
  const free = i.amount - i.reserve.synthesis - i.reserve.check;
  return {
    amount: i.amount,
    unit: i.unit,
    depth: i.depth,
    perRepo: Math.max(0, Math.floor(free / i.repoCount)),
    reserve: { ...i.reserve },
  };
}
