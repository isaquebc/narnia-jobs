import type { IngestionDepth, PlanUsage } from "@narnia-jobs/shared";

/** F03-3 §1: o recomendado nunca passa de 70% do que resta na janela de 5 h. */
export const RECOMMEND_WINDOW_SHARE = 0.7;

export interface RecommendInput {
  depth: IngestionDepth;
  defaults: Record<IngestionDepth, number>;
  planUsage: PlanUsage | null;
  /** Conversão aprendida % → tokens por modelo (`settings.budget.pct_to_tokens`). */
  pctToTokens: Record<string, number>;
  model: string;
}

export interface BudgetRecommendation {
  amount: number;
  /** Sem dados do plano ou sem conversão aprendida: a UI marca "aproximado". */
  approximate: boolean;
  basis: "default" | "window";
  windowRemainingPct: number | null;
  windowRemainingTokens: number | null;
  resetsAt: string | null;
}

/** Recomendado = min(padrão da profundidade, 70% do restante da janela de 5 h convertido em tokens). */
export function recommendBudget(i: RecommendInput): BudgetRecommendation {
  const fallback = i.defaults[i.depth];
  const window = i.planUsage?.windows.fiveHour ?? null;
  const remainingPct =
    window?.utilization === null || window?.utilization === undefined
      ? null
      : Math.max(0, 100 - window.utilization);
  const perPct = i.pctToTokens[i.model] ?? null;
  const remainingTokens =
    remainingPct !== null && perPct ? Math.floor(remainingPct * perPct) : null;
  const base = {
    windowRemainingPct: remainingPct,
    windowRemainingTokens: remainingTokens,
    resetsAt: window?.resetsAt ?? null,
  };
  if (remainingTokens === null)
    return { amount: fallback, approximate: true, basis: "default", ...base };
  const fromWindow = Math.floor(remainingTokens * RECOMMEND_WINDOW_SHARE);
  return fromWindow < fallback
    ? { amount: fromWindow, approximate: false, basis: "window", ...base }
    : { amount: fallback, approximate: false, basis: "default", ...base };
}
