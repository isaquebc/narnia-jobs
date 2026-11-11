import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common";

/**
 * Tarefas agendadas (F14-12, §2.6): rotinas periódicas do narnia rodando no worker, com o log de cada execução e o
 * que ela tocou (e-mails, vagas, candidaturas). As definições ficam no código (`SCHEDULED_TASKS`, core); o banco guarda
 * o intervalo escolhido, a pausa, a próxima execução e o histórico.
 */
export const SCHEDULED_TASK_IDS = ["captures.prune", "job_applications.archive"] as const;
export const ScheduledTaskIdSchema = z.enum(SCHEDULED_TASK_IDS);
export type ScheduledTaskId = z.infer<typeof ScheduledTaskIdSchema>;

export const ScheduledRunTriggerSchema = z.enum(["schedule", "manual"]);
export const ScheduledRunStatusSchema = z.enum(["running", "done", "error"]);
export const ScheduledLogLevelSchema = z.enum(["info", "warn", "error"]);

export const ScheduledRunSchema = z.object({
  id: IdSchema,
  taskId: ScheduledTaskIdSchema,
  trigger: ScheduledRunTriggerSchema,
  status: ScheduledRunStatusSchema,
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema.nullable(),
  /** Contadores da execução (ex.: `{ archived: 2 }`, `{ read: 30, postings: 12 }`). */
  counts: z.record(z.string(), z.number()),
  error: z.string().nullable(),
  itemCount: z.number().int().min(0),
});
export type ScheduledRun = z.infer<typeof ScheduledRunSchema>;

export const ScheduledRunLogSchema = z.object({
  id: z.number().int(),
  at: IsoDateTimeSchema,
  level: ScheduledLogLevelSchema,
  message: z.string(),
});

/** O que a execução tocou: `kind` diz o alvo (e-mail, vaga, candidatura, captura), `action` o que foi feito. */
export const ScheduledRunItemSchema = z.object({
  id: z.number().int(),
  at: IsoDateTimeSchema,
  kind: z.string(),
  refId: z.string().nullable(),
  label: z.string(),
  action: z.string(),
  result: z.enum(["ok", "skipped", "error"]),
  detail: z.string().nullable(),
  /** Caminho na web para abrir o alvo (`/vagas/<id>`, `/candidaturas/<id>`), quando houver. */
  href: z
    .string()
    .regex(/^\/(?!\/)/)
    .nullable(),
});
export type ScheduledRunItem = z.infer<typeof ScheduledRunItemSchema>;

export const ScheduledRunDetailSchema = ScheduledRunSchema.extend({
  log: z.array(ScheduledRunLogSchema),
  items: z.array(ScheduledRunItemSchema),
});
export type ScheduledRunDetail = z.infer<typeof ScheduledRunDetailSchema>;

export const ScheduledTaskSchema = z.object({
  id: ScheduledTaskIdSchema,
  intervalMinutes: z.number().int().min(1),
  defaultIntervalMinutes: z.number().int().min(1),
  minIntervalMinutes: z.number().int().min(1),
  paused: z.boolean(),
  nextRunAt: IsoDateTimeSchema.nullable(),
  lastRun: ScheduledRunSchema.nullable(),
  running: z.boolean(),
});
export type ScheduledTask = z.infer<typeof ScheduledTaskSchema>;

export const ScheduledTaskPatchSchema = z
  .object({
    intervalMinutes: z
      .number()
      .int()
      .min(1)
      .max(60 * 24 * 30)
      .optional(),
    paused: z.boolean().optional(),
  })
  .refine((v) => v.intervalMinutes !== undefined || v.paused !== undefined, "nada para mudar");
export type ScheduledTaskPatch = z.infer<typeof ScheduledTaskPatchSchema>;

/** Execução começou ou terminou: a tela de tarefas agendadas recarrega. */
export const ScheduledRunUpdatedEventSchema = z.object({
  type: z.literal("scheduled_run.updated"),
  taskId: ScheduledTaskIdSchema,
  runId: IdSchema,
  status: ScheduledRunStatusSchema,
});
