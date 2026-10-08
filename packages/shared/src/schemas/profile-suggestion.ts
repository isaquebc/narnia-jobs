import { z } from "zod";
import { IdSchema, IsoDateTimeSchema, SenioritySchema } from "./common";
import { SkillCategorySchema } from "./fact-proposal";

/** Sugestões de perfil (F02 §2.6): heurísticas (zero tokens) ou do modelo ("Analisar possíveis perfis"). */
export const SuggestionSourceSchema = z.enum(["heuristic", "model"]);
export const SuggestionStatusSchema = z.enum(["new", "accepted", "dismissed"]);

export const ProfileSuggestionPayloadSchema = z.object({
  title: z.string().min(1),
  seniority: SenioritySchema,
  area: z.string().min(1),
  market: z.string().min(2),
  rationale: z.string().min(1),
  supportingFactIds: z.array(IdSchema),
});
export type ProfileSuggestionPayload = z.infer<typeof ProfileSuggestionPayloadSchema>;

export const ProfileSuggestionSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  source: SuggestionSourceSchema,
  model: z.string().min(1).nullable().optional(),
  payload: ProfileSuggestionPayloadSchema,
  status: SuggestionStatusSchema,
  createdAt: IsoDateTimeSchema,
  decidedAt: IsoDateTimeSchema.nullable(),
});
export type ProfileSuggestion = z.infer<typeof ProfileSuggestionSchema>;

/** Entrada compacta da análise pelo modelo (montada por `core/profile/analyze-input.ts`; uma linha por item). */
export const AnalyzeProfilesInputSchema = z.object({
  identity: z.object({
    name: z.string().min(1),
    city: z.string().optional(),
    country: z.string().optional(),
    remotePref: z.string().optional(),
  }),
  experiences: z
    .array(
      z.object({
        id: IdSchema,
        company: z.string(),
        title: z.string(),
        period: z.string(),
        summary: z.string().optional(),
        tech: z.array(z.string()).default([]),
        achievements: z
          .array(z.object({ id: IdSchema, text: z.string(), metric: z.string().optional() }))
          .default([]),
      }),
    )
    .default([]),
  projects: z
    .array(
      z.object({
        id: IdSchema,
        name: z.string(),
        description: z.string().optional(),
        tech: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  education: z
    .array(
      z.object({
        id: IdSchema,
        institution: z.string(),
        course: z.string(),
        degree: z.string().optional(),
        period: z.string().optional(),
      }),
    )
    .default([]),
  skills: z
    .array(
      z.object({
        id: IdSchema,
        name: z.string(),
        category: SkillCategorySchema,
        level: z.number().int().min(1).max(5).optional(),
      }),
    )
    .default([]),
  languages: z.array(z.object({ id: IdSchema, name: z.string(), level: z.string() })).default([]),
  digests: z.array(z.object({ fileName: z.string(), summary: z.string() })).default([]),
  existingProfiles: z
    .array(
      z.object({
        name: z.string(),
        targetTitle: z.string(),
        seniority: SenioritySchema,
        area: z.string(),
      }),
    )
    .default([]),
  dismissedTitles: z.array(z.string()).default([]),
});
export type AnalyzeProfilesInput = z.infer<typeof AnalyzeProfilesInputSchema>;

/** Saída estruturada do modelo (`outputFormat`), plana para gerar JSON Schema simples. */
export const AnalyzeProfilesOutputSchema = z.object({
  suggestions: z.array(ProfileSuggestionPayloadSchema).max(5),
});
export type AnalyzeProfilesOutput = z.infer<typeof AnalyzeProfilesOutputSchema>;
