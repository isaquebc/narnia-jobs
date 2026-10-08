import { z } from "zod";
import { SenioritySchema } from "./common";

/** Persona do recrutador (F02 §2.4, decisão F02-7): enums com padrão, configuráveis pela interface; sem texto livre. */
export const PersonaToneSchema = z.enum(["direto", "cordial"]);
export const PersonaHonestySchema = z.enum(["maxima", "diplomatica"]);
export const PersonaRigorSchema = z.enum(["alto", "medio"]);
export const RecruiterSenioritySchema = z.enum(["senior", "pleno"]);

export const DocLocaleSchema = z.string().regex(/^[a-z]{2}-[A-Z]{2}$/, "Locale como pt-BR");

export const PersonaSchema = z.object({
  specialty: z.string().min(1),
  targetLevel: SenioritySchema,
  market: z.string().min(2),
  language: DocLocaleSchema,
  tone: PersonaToneSchema,
  honesty: PersonaHonestySchema,
  rigor: PersonaRigorSchema,
  recruiterSeniority: RecruiterSenioritySchema,
});
export type Persona = z.infer<typeof PersonaSchema>;

export const PERSONA_DEFAULTS = {
  tone: "direto",
  honesty: "maxima",
  rigor: "alto",
  recruiterSeniority: "senior",
} as const satisfies Pick<Persona, "tone" | "honesty" | "rigor" | "recruiterSeniority">;

/** Só os campos sobrescritos; `null` em um campo = restaurar o padrão. */
export const PersonaOverridesSchema = z.object({
  specialty: z.string().min(1).nullable().optional(),
  market: z.string().min(2).nullable().optional(),
  language: DocLocaleSchema.nullable().optional(),
  tone: PersonaToneSchema.nullable().optional(),
  honesty: PersonaHonestySchema.nullable().optional(),
  rigor: PersonaRigorSchema.nullable().optional(),
  recruiterSeniority: RecruiterSenioritySchema.nullable().optional(),
});
export type PersonaOverrides = z.infer<typeof PersonaOverridesSchema>;
