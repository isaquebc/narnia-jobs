import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common";

export const JOB_STATUSES = ["queued", "active", "done", "error", "cancelled", "stalled"] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const QUEUE_NAMES = ["ingest", "ocr", "extract"] as const;
export const QueueNameSchema = z.enum(QUEUE_NAMES);

/** Espelho durável de um job da BullMQ (F01 §3 `job`). */
export const JobSchema = z.object({
  id: IdSchema,
  queue: QueueNameSchema,
  type: z.string().min(1),
  parentId: IdSchema.nullable(),
  profileId: IdSchema.nullable(),
  status: JobStatusSchema,
  progress: z.number().min(0).max(100),
  stage: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  attempts: z.number().int().min(0),
  createdAt: IsoDateTimeSchema,
  startedAt: IsoDateTimeSchema.nullable(),
  finishedAt: IsoDateTimeSchema.nullable(),
  /** Último sinal do job (evento, progresso ou batimento): base do "parece parada" (plano de comunicação C3). */
  updatedAt: IsoDateTimeSchema.nullable().optional(),
});
export type Job = z.infer<typeof JobSchema>;
