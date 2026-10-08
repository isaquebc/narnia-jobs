import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common";

/** Ênfases por perfil (F02 §2.1): a lente nunca duplica fatos, só marca e ordena. Ordem = a da UI do quadro. */
export const EMPHASIS_FACT_KINDS = [
  "experience",
  "project",
  "skill",
  "education",
  "language",
  "achievement",
] as const;
export const EmphasisFactKindSchema = z.enum(EMPHASIS_FACT_KINDS);
export type EmphasisFactKind = z.infer<typeof EmphasisFactKindSchema>;

export const EmphasisModeSchema = z.enum(["highlight", "normal", "hidden"]);
export type EmphasisMode = z.infer<typeof EmphasisModeSchema>;

export const ProfileEmphasisSchema = z.object({
  id: IdSchema,
  profileId: IdSchema,
  factKind: EmphasisFactKindSchema,
  factId: IdSchema,
  mode: EmphasisModeSchema,
  position: z.number().int().min(0).nullable(),
  updatedAt: IsoDateTimeSchema,
});
export type ProfileEmphasis = z.infer<typeof ProfileEmphasisSchema>;

/** Item da substituição em lote (`PUT /api/profiles/:id/emphasis` e tool `profile.update_emphasis`). */
export const EmphasisItemSchema = z.object({
  kind: EmphasisFactKindSchema,
  id: IdSchema,
  mode: EmphasisModeSchema,
  position: z.number().int().min(0).optional(),
});
export type EmphasisItem = z.infer<typeof EmphasisItemSchema>;

/** Relevância por fato e perfil (F02 §2.3), calculada junto com o cartão. */
export const ProfileFactRelevanceSchema = z.object({
  profileId: IdSchema,
  factKind: EmphasisFactKindSchema,
  factId: IdSchema,
  score: z.number().min(0).max(1),
  reasons: z.array(z.string().min(1)),
  computedAt: IsoDateTimeSchema,
});
export type ProfileFactRelevance = z.infer<typeof ProfileFactRelevanceSchema>;
