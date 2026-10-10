import type { BudgetUnit } from "@narnia-jobs/shared";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { t } from "../../i18n";

/**
 * Valor digitado na unidade escolhida → tokens. `% da janela` usa a conversão aprendida para o modelo (FX-4);
 * sem conversão a unidade fica desabilitada na tela, e aqui cai em mil tokens só por segurança.
 */
export function toTokens(
  value: number,
  unit: BudgetUnit,
  pctToTokens: number | null = null,
): number {
  if (unit === "window_pct" && pctToTokens) return Math.round(value * pctToTokens);
  const factor = unit === "million" ? 1_000_000 : 1_000;
  return Math.round(value * factor);
}

export function fromTokens(
  tokens: number,
  unit: BudgetUnit,
  pctToTokens: number | null = null,
): number {
  if (unit === "window_pct" && pctToTokens) return Number((tokens / pctToTokens).toFixed(1));
  const factor = unit === "million" ? 1_000_000 : 1_000;
  return Number((tokens / factor).toFixed(3));
}

export function BudgetInput({
  value,
  unit,
  model,
  pctToTokens,
  onValueChange,
  onUnitChange,
}: {
  value: string;
  unit: BudgetUnit;
  model: string;
  /** Conversão aprendida % → tokens para `model` (FX-4); `null` desabilita a unidade %. */
  pctToTokens: number | null;
  onValueChange: (v: string) => void;
  onUnitChange: (u: BudgetUnit) => void;
}) {
  const amount = Number(value);
  const equivalent =
    unit === "window_pct" && pctToTokens && Number.isFinite(amount) && amount > 0
      ? t("budget.pctEquivalent", {
          pct: amount,
          tokens: Math.round(toTokens(amount, unit, pctToTokens) / 1000),
          model,
        })
      : null;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label={t("budget.amount")} htmlFor="budget-amount">
        <Input
          id="budget-amount"
          type="number"
          min={0}
          step="any"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          className="w-32"
        />
      </Field>
      <Field label={t("budget.unit")} htmlFor="budget-unit">
        <select
          id="budget-unit"
          value={unit}
          onChange={(e) => onUnitChange(e.target.value as BudgetUnit)}
          className="h-10 rounded-md border border-border bg-card px-2 text-sm"
        >
          <option value="thousand">{t("budget.units.thousand")}</option>
          <option value="million">{t("budget.units.million")}</option>
          <option value="window_pct" disabled={!pctToTokens}>
            {t("budget.units.window_pct")}
          </option>
        </select>
      </Field>
      {!pctToTokens ? (
        <span className="pb-2 text-xs text-muted-fg">{t("budget.pctUnavailable")}</span>
      ) : null}
      {equivalent ? <span className="pb-2 text-xs text-muted-fg">{equivalent}</span> : null}
    </div>
  );
}
