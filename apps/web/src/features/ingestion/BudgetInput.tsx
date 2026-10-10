import type { BudgetUnit } from "@narnia-jobs/shared";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { t } from "../../i18n";

/** Valor digitado na unidade escolhida → tokens. `% da janela` usa mil tokens até haver conversão (F03-40). */
export function toTokens(value: number, unit: BudgetUnit): number {
  const factor = unit === "million" ? 1_000_000 : 1_000;
  return Math.round(value * factor);
}

export function fromTokens(tokens: number, unit: BudgetUnit): number {
  const factor = unit === "million" ? 1_000_000 : 1_000;
  return Number((tokens / factor).toFixed(3));
}

export function BudgetInput({
  value,
  unit,
  onValueChange,
  onUnitChange,
}: {
  value: string;
  unit: BudgetUnit;
  onValueChange: (v: string) => void;
  onUnitChange: (u: BudgetUnit) => void;
}) {
  return (
    <div className="flex items-end gap-2">
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
          <option value="window_pct">{t("budget.units.window_pct")}</option>
        </select>
      </Field>
      {unit === "window_pct" ? (
        <span className="pb-2 text-xs text-muted-fg">{t("budget.pctHint")}</span>
      ) : null}
    </div>
  );
}
