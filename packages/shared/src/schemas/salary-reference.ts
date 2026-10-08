import { z } from "zod";
import {
  IdSchema,
  IsoCountrySchema,
  IsoCurrencySchema,
  IsoDateTimeSchema,
  UrlSchema,
} from "./common";
import { SalaryPeriodSchema } from "./profile";

/** Referência salarial externa (F01 §3 `salary_reference`), ex.: salário mínimo necessário do DIEESE. */
export const SalaryReferenceSchema = z.object({
  id: IdSchema,
  country: IsoCountrySchema,
  source: z.enum(["dieese", "manual", "research"]),
  indicator: z.string().min(1),
  value: z.number().positive(),
  currency: IsoCurrencySchema,
  period: SalaryPeriodSchema,
  referenceMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês de referência YYYY-MM"),
  sourceUrl: UrlSchema,
  fetchedAt: IsoDateTimeSchema,
  isCurrent: z.boolean(),
});
export type SalaryReference = z.infer<typeof SalaryReferenceSchema>;
