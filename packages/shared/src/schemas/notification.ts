import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common";

/**
 * Notificações (F03-10): infraestrutura geral. Pendências são resolvidas pelo fluxo dono do assunto (revisão salva,
 * decisão tomada), não por clique; dispensar só esconde. Tasks futuras acrescentam tipos aqui.
 */
export const NOTIFICATION_KINDS = [
  "review.pending",
  "review.conflicts",
  "ingestion.awaiting_decision",
  "ingestion.done",
  "ingestion.error",
  "profile.suggestion",
  "profile.analysis_done",
  "data.recreated",
  "snapshots.over_cap",
  "ingestion.awaiting_confirmation",
] as const;
export const NotificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

export const NotificationSeveritySchema = z.enum(["info", "warning", "error"]);

export const NotificationSchema = z.object({
  id: IdSchema,
  kind: NotificationKindSchema,
  subjectKind: z.string().min(1),
  subjectId: IdSchema,
  title: z.string().min(1),
  body: z.string().nullable(),
  actionUrl: z.string().startsWith("/"),
  severity: NotificationSeveritySchema,
  createdAt: IsoDateTimeSchema,
  readAt: IsoDateTimeSchema.nullable(),
  dismissedAt: IsoDateTimeSchema.nullable(),
  resolvedAt: IsoDateTimeSchema.nullable(),
});
export type Notification = z.infer<typeof NotificationSchema>;
