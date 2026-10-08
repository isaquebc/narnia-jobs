import { z } from "zod";
import { IsoDateTimeSchema } from "./common";

/** Cartão do perfil (F02 §2.2): ~300 tokens, cache em `profile.card_json`, validade por `factsVersion`. */
export const ProfileCardSchema = z.object({
  text: z.string().min(1),
  tokensEst: z.number().int().min(0),
  hash: z.string().min(1),
  factsVersion: z.number().int().min(0),
  builtAt: IsoDateTimeSchema,
});
export type ProfileCard = z.infer<typeof ProfileCardSchema>;

/** Teto rígido do cartão em caracteres (F02-2). */
export const PROFILE_CARD_MAX_CHARS = 1_600;
