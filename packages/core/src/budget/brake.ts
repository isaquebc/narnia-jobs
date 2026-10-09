import type { PlanUsage } from "@narnia-jobs/shared";

/** F03-3 §6: passou de 125% do orçamento, a execução pausa antes do próximo repositório e pergunta ao usuário. */
export const BRAKE_FACTOR = 1.25;

export function shouldBrake(budget: { amount: number }, usedTokens: number): boolean {
  return usedTokens > budget.amount * BRAKE_FACTOR;
}

/** Custo estimado para terminar: repositórios restantes + síntese + revisor. */
export function costToFinish(i: {
  remainingRepos: { tokens: number }[];
  synthesisTokens: number;
  checkTokens: number;
}): number {
  return i.remainingRepos.reduce((n, r) => n + r.tokens, 0) + i.synthesisTokens + i.checkTokens;
}

export interface BrakeSummary {
  budget: number;
  used: number;
  estimated: number;
  toFinish: number;
  overBy: number;
  /** Restante da janela de 5 h (do adaptador do plano); `null` sem dados. */
  window: { remainingPct: number; remainingTokens: number | null; resetsAt: string | null } | null;
  /** O custo para terminar cabe no restante da janela (só com conversão aprendida). */
  fitsWindow: boolean | null;
}

/** O que a tela "aguardando decisão" mostra: gasto × estimado, restante da janela e custo para terminar. */
export function brakeSummary(i: {
  budget: number;
  usedTokens: number;
  estimatedTokens: number;
  toFinish: number;
  planUsage: PlanUsage | null;
  pctToTokens: number | null;
}): BrakeSummary {
  const w = i.planUsage?.windows.fiveHour ?? null;
  const remainingPct = w && w.utilization !== null ? Math.max(0, 100 - w.utilization) : null;
  const remainingTokens =
    remainingPct !== null && i.pctToTokens ? Math.floor(remainingPct * i.pctToTokens) : null;
  return {
    budget: i.budget,
    used: i.usedTokens,
    estimated: i.estimatedTokens,
    toFinish: i.toFinish,
    overBy: Math.max(0, i.usedTokens - i.budget),
    window:
      remainingPct === null
        ? null
        : { remainingPct, remainingTokens, resetsAt: w?.resetsAt ?? null },
    fitsWindow: remainingTokens === null ? null : i.toFinish <= remainingTokens,
  };
}
