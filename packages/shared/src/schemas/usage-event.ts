import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common";

export const UsageOriginSchema = z.enum(["narnia", "claude-log"]);
const tokens = z.number().int().min(0);

/** Evento de uso de modelo (F01 §3 `usage_event`), base do medidor. */
export const UsageEventSchema = z.object({
  id: IdSchema,
  ts: IsoDateTimeSchema,
  origin: UsageOriginSchema,
  category: z.string().min(1),
  jobId: IdSchema.nullable(),
  sessionId: IdSchema.nullable(),
  model: z.string().min(1),
  inputTokens: tokens,
  outputTokens: tokens,
  cacheRead: tokens,
  cacheWrite: tokens,
  costUsdEst: z.number().min(0),
});
export type UsageEvent = z.infer<typeof UsageEventSchema>;
