import type { SalaryRange, SalaryReference } from "@narnia-jobs/shared";
import { Alert } from "../../../components/ui/alert";
import { t } from "../../../i18n";
import { formatMoney, formatMonth } from "../../../lib/format";

/** Mesma regra do `core` (F01-15): só BRL; mensal direto, anual ÷ 12; outras moedas/períodos → null. */
export function isBelowReference(salary: SalaryRange, ref: SalaryReference | null): boolean | null {
  if (!ref || salary.currency !== ref.currency || ref.period !== "monthly") return null;
  let monthly: number;
  if (salary.period === "monthly") monthly = salary.min;
  else if (salary.period === "yearly") monthly = salary.min / 12;
  else return null;
  return monthly < ref.value;
}

export function SalaryReferenceAlert({
  salary,
  reference,
}: {
  salary: SalaryRange | undefined;
  reference: SalaryReference | null;
}) {
  if (!salary || !reference) return null;
  if (isBelowReference(salary, reference) !== true) return null;
  return (
    <Alert tone="warn" className="flex items-center justify-between gap-3">
      <span>
        {t("profile.referenceAlert", {
          month: formatMonth(reference.referenceMonth),
          value: formatMoney(reference.value, reference.currency),
        })}
      </span>
      <a href={reference.sourceUrl} target="_blank" rel="noreferrer" className="shrink-0 underline">
        {t("profile.referenceSource")}
      </a>
    </Alert>
  );
}
