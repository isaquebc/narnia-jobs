import type { BudgetUnit } from "@narnia-jobs/shared";

/**
 * Unidades de exibição do orçamento (F03-3 §1). O valor guardado é sempre em tokens; `% da janela` depende da
 * conversão aprendida por modelo (tokens por 1% da janela de 5 h) e devolve `null` sem ela.
 */
export interface UnitContext {
  /** Tokens que valem 1% da janela de 5 h para o modelo escolhido; `null` sem histórico. */
  pctToTokens?: number | null;
}

export function toDisplay(tokens: number, unit: BudgetUnit, ctx: UnitContext = {}): number | null {
  if (unit === "thousand") return tokens / 1_000;
  if (unit === "million") return tokens / 1_000_000;
  return ctx.pctToTokens ? Math.round((tokens / ctx.pctToTokens) * 10) / 10 : null;
}

export function fromDisplay(
  amount: number,
  unit: BudgetUnit,
  ctx: UnitContext = {},
): number | null {
  if (unit === "thousand") return Math.round(amount * 1_000);
  if (unit === "million") return Math.round(amount * 1_000_000);
  return ctx.pctToTokens ? Math.round(amount * ctx.pctToTokens) : null;
}

const fmt = (n: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(n);

/** Texto pt-BR para a UI e as notificações; `% da janela` sem conversão cai para mil tokens. */
export function formatBudget(tokens: number, unit: BudgetUnit, ctx: UnitContext = {}): string {
  if (unit === "million") {
    const v = tokens / 1_000_000;
    return `${fmt(v)} ${v >= 2 ? "milhões" : "milhão"} de tokens`;
  }
  if (unit === "window_pct") {
    const pct = toDisplay(tokens, unit, ctx);
    if (pct !== null) return `${fmt(pct)}% da janela`;
  }
  return `${fmt(tokens / 1_000)} mil tokens`;
}
