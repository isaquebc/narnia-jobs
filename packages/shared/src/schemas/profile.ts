import { z } from "zod";
import {
  IdSchema,
  IsoCountrySchema,
  IsoCurrencySchema,
  IsoDateTimeSchema,
  RemotePrefSchema,
} from "./common";

export const SenioritySchema = z.enum([
  "junior",
  "pleno",
  "senior",
  "staff",
  "manager",
  "director",
]);
export const GoalSchema = z.enum(["new_job", "career_change", "freelance", "promotion"]);
export const SalaryPeriodSchema = z.enum(["monthly", "yearly", "hourly"]);
export const ContractTypeSchema = z.enum(["clt", "pj", "freelance", "internship", "temporary"]);

export const SalaryRangeSchema = z
  .object({
    min: z.number().positive(),
    max: z.number().positive(),
    currency: IsoCurrencySchema,
    period: SalaryPeriodSchema,
  })
  .refine((s) => s.min <= s.max, {
    message: "Salário mínimo não pode exceder o máximo",
    path: ["min"],
  });
export type SalaryRange = z.infer<typeof SalaryRangeSchema>;

export const LocationPrefSchema = z.object({
  country: IsoCountrySchema,
  city: z.string().optional(),
  remote: RemotePrefSchema,
});

export const AvailableFromSchema = z.union([z.literal("immediate"), z.iso.date()]);

/** Campos de carreira obrigatórios que podem ser adiados com "não sei" (`needsResearch`). */
export const RESEARCHABLE_FIELDS = [
  "salary",
  "contractTypes",
  "locations",
  "availableFrom",
] as const;
export const ResearchableFieldSchema = z.enum(RESEARCHABLE_FIELDS);
export type ResearchableField = z.infer<typeof ResearchableFieldSchema>;

/** Base sem refinamento (para `omit`/`extend`). Use `ProfileSchema` para validar. */
export const ProfileBaseSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  name: z.string().min(1),
  targetTitle: z.string().min(1),
  altTitles: z.array(z.string().min(1)),
  seniority: SenioritySchema,
  area: z.string().min(1),
  goal: GoalSchema,
  market: z.string().min(2),
  docLocale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/, "Locale como pt-BR"),
  salary: SalaryRangeSchema.optional(),
  salaryBelowReference: z.boolean().default(false),
  contractTypes: z.array(ContractTypeSchema).default([]),
  locations: z.array(LocationPrefSchema).default([]),
  availableFrom: AvailableFromSchema.optional(),
  needsResearch: z.array(ResearchableFieldSchema).default([]),
  pitch: z.string().nullable().optional(),
  cardJson: z.string().nullable().optional(),
  cardUpdatedAt: IsoDateTimeSchema.nullable().optional(),
  isActive: z.boolean(),
});

type CareerFields = {
  salary?: unknown;
  contractTypes: unknown[];
  locations: unknown[];
  availableFrom?: unknown;
  needsResearch: ResearchableField[];
};

/** Regra F01-15: campos de carreira obrigatórios, exceto os marcados em `needsResearch` ("não sei"). */
export function requireCareerFields(p: CareerFields, ctx: z.RefinementCtx): void {
  const pending = new Set<ResearchableField>(p.needsResearch);
  const missing: Array<[ResearchableField, boolean]> = [
    ["salary", p.salary === undefined],
    ["contractTypes", p.contractTypes.length === 0],
    ["locations", p.locations.length === 0],
    ["availableFrom", p.availableFrom === undefined],
  ];
  for (const [field, isMissing] of missing) {
    if (isMissing && !pending.has(field)) {
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: 'Campo obrigatório; marque "não sei" (needsResearch) para adiar',
      });
    }
  }
}

/**
 * Perfil (F01 §3 `profile`). Faixa salarial, tipos de contrato, localidades e disponibilidade são
 * obrigatórios, exceto quando o campo está em `needsResearch` (decisão F01-15).
 */
export const ProfileSchema = ProfileBaseSchema.superRefine(requireCareerFields);
export type Profile = z.infer<typeof ProfileSchema>;
export type ProfileInput = z.input<typeof ProfileSchema>;
