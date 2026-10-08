import type { SalaryPeriodSchema, SalaryReference } from "@narnia-jobs/shared";
import type { z } from "zod";

type SalaryPeriod = z.infer<typeof SalaryPeriodSchema>;

/**
 * Piso de referência (decisão F01-15): só compara BRL mensal (anual ÷ 12). Qualquer outro caso devolve
 * `null`, que significa "sem comparação", nunca "abaixo". O sistema só informa; o usuário decide.
 */
export function isBelowReference(
  min: number,
  currency: string,
  period: SalaryPeriod,
  ref: SalaryReference | null | undefined,
): boolean | null {
  if (!ref?.isCurrent) return null;
  if (currency !== ref.currency || ref.period !== "monthly") return null;
  let monthly: number;
  if (period === "monthly") monthly = min;
  else if (period === "yearly") monthly = min / 12;
  else return null;
  return monthly < ref.value;
}
