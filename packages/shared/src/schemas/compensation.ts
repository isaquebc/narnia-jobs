import { z } from "zod";
import { IsoCurrencySchema } from "./common";
import { type ContractTypeSchema, SalaryPeriodSchema } from "./profile";

/**
 * Remuneração de uma experiência (pedido do dono, 2026-10-13): valor, período (hora, mês, ano) e moeda, separados do
 * tipo de contrato e da carga horária semanal, para comparar experiências na mesma base (equivalente mensal) e ver se
 * a pessoa está subindo ou descendo o próprio salário.
 */
export const CompensationSchema = z.object({
  amount: z.number().positive(),
  period: SalaryPeriodSchema,
  currency: IsoCurrencySchema,
});
export type Compensation = z.infer<typeof CompensationSchema>;

/** Benefícios para selecionar (lista aprovada pelo dono); o resto vai em texto livre (`benefitsOther`). */
export const BENEFITS = [
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
] as const;
export const BenefitSchema = z.enum(BENEFITS);
export type Benefit = z.infer<typeof BenefitSchema>;

export const BENEFIT_LABELS: Record<Benefit, string> = {
  meal_voucher: "Vale-refeição/alimentação",
  health_plan: "Plano de saúde",
  dental_plan: "Plano odontológico",
  life_insurance: "Seguro de vida",
  transport_voucher: "Vale-transporte",
  home_office_allowance: "Auxílio home office",
  profit_sharing: "PLR/bônus",
  equity: "Ações/stock options",
  thirteenth_salary: "13º salário",
  paid_vacation: "Férias remuneradas",
  education_allowance: "Auxílio educação",
  private_pension: "Previdência privada",
  gym: "Academia (Gympass/Wellhub)",
  birthday_day_off: "Day off de aniversário",
};

export const CONTRACT_TYPE_LABELS: Record<z.infer<typeof ContractTypeSchema>, string> = {
  clt: "CLT",
  pj: "PJ",
  freelance: "Freelance",
  internship: "Estágio",
  temporary: "Temporário",
};

/** Semanas por mês (52/12): converte carga semanal em horas por mês. */
const WEEKS_PER_MONTH = 52 / 12;
const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * Equivalentes por hora, mês e ano. Por hora → mês precisa da carga semanal; ano = 12 × mês (sem 13º nem férias: a
 * comparação é entre bases iguais). `null` quando não dá para saber.
 */
export function compensationEquivalents(
  c: Compensation,
  weeklyHours?: number | null,
): { hourly: number | null; monthly: number | null; yearly: number | null } {
  const hoursPerMonth = weeklyHours ? weeklyHours * WEEKS_PER_MONTH : null;
  const monthly =
    c.period === "monthly"
      ? c.amount
      : c.period === "yearly"
        ? c.amount / 12
        : hoursPerMonth
          ? c.amount * hoursPerMonth
          : null;
  const hourly =
    c.period === "hourly"
      ? c.amount
      : monthly !== null && hoursPerMonth
        ? monthly / hoursPerMonth
        : null;
  return {
    hourly: hourly === null ? null : round(hourly),
    monthly: monthly === null ? null : round(monthly),
    yearly: monthly === null ? null : round(monthly * 12),
  };
}

const PERIOD_LABEL = { hourly: "hora", monthly: "mês", yearly: "ano" } as const;

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency })
      .format(amount)
      .replace(/ /g, " ");
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** "R$ 100,00/hora (≈ R$ 13.000,00/mês com 30 h/semana)". */
export function formatCompensation(c: Compensation, weeklyHours?: number | null): string {
  const main = `${formatMoney(c.amount, c.currency)}/${PERIOD_LABEL[c.period]}`;
  if (c.period === "monthly") return main;
  const eq = compensationEquivalents(c, weeklyHours);
  if (eq.monthly === null) return main;
  const hours = c.period === "hourly" && weeklyHours ? ` com ${weeklyHours} h/semana` : "";
  return `${main} (≈ ${formatMoney(eq.monthly, c.currency)}/mês${hours})`;
}

export interface TrajectoryPoint {
  company: string;
  startDate: string;
  monthly: number;
  currency: string;
  /** Variação relativa ao ponto anterior na mesma moeda (0.25 = +25%); null no primeiro ou com moeda diferente. */
  change: number | null;
}

/** Trajetória do equivalente mensal, em ordem cronológica (só experiências com salário que dá para converter). */
export function compensationTrajectory(
  experiences: Array<{
    company: string;
    startDate: string;
    weeklyHours?: number | null | undefined;
    compensation?: Compensation | null | undefined;
  }>,
): TrajectoryPoint[] {
  const points = experiences
    .filter((e) => e.compensation)
    .map((e) => ({
      company: e.company,
      startDate: e.startDate,
      monthly: compensationEquivalents(e.compensation as Compensation, e.weeklyHours).monthly,
      currency: (e.compensation as Compensation).currency,
    }))
    .filter((p): p is Omit<TrajectoryPoint, "change"> => p.monthly !== null)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  return points.map((p, i) => {
    const prev = points[i - 1];
    return {
      ...p,
      change: prev && prev.currency === p.currency ? round(p.monthly / prev.monthly - 1, 4) : null,
    };
  });
}
