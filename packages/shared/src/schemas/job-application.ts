import { z } from "zod";
import { IdSchema, IsoDateTimeSchema, TimeZoneSchema } from "./common";
import { PostingArchiveReasonSchema, PostingSchema } from "./posting";

/**
 * Candidatura (F07 §0, requisitos do dono 2026-10-27). Nasce só do botão "Aplicar" numa vaga salva, com a versão do CV
 * (obrigatória, F07-10) e a da carta (se houver) travadas e a data da candidatura. O domínio no código é
 * `jobApplication` porque `application` já é o formulário da extensão (F12).
 */

/** Colunas do quadro (§0.2). A coluna é o que a pessoa move; o pipeline de etapas é independente (F07-8). */
export const JOB_APPLICATION_COLUMNS = [
  "applied",
  "first_interview",
  "in_process",
  "offer",
  "closed",
] as const;
export const JobApplicationColumnSchema = z.enum(JOB_APPLICATION_COLUMNS);
export type JobApplicationColumn = z.infer<typeof JobApplicationColumnSchema>;

/** Motivo do encerramento (F07-6: obrigatório ao mover para Encerrado). */
export const JobApplicationClosedReasonSchema = z.enum([
  "hired",
  "declined",
  "rejected",
  "withdrew",
  "no_response",
]);
export type JobApplicationClosedReason = z.infer<typeof JobApplicationClosedReasonSchema>;

/** Data da candidatura: só o dia (YYYY-MM-DD), sem fuso. */
export const CalendarDateSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Use YYYY-MM-DD");

/** Etapa do processo seletivo (pipeline de cada candidatura; uma tem 3, outra 6). */
export const JobApplicationStageSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  position: z.number().int().min(1),
});
export type JobApplicationStage = z.infer<typeof JobApplicationStageSchema>;

/** Versão travada de um documento (o que foi enviado; regerar depois não muda). */
export const LockedDocumentSchema = z.object({
  documentId: IdSchema,
  versionId: IdSchema,
  version: z.number().int().min(1),
  /** CV da vaga ou geral do perfil (sem vaga). */
  scope: z.enum(["posting", "profile"]),
});
export type LockedDocument = z.infer<typeof LockedDocumentSchema>;

export const JobApplicationSchema = z.object({
  id: IdSchema,
  postingId: IdSchema,
  profileId: IdSchema.nullable(),
  cv: LockedDocumentSchema,
  coverLetter: LockedDocumentSchema.nullable(),
  appliedOn: CalendarDateSchema,
  column: JobApplicationColumnSchema,
  closedReason: JobApplicationClosedReasonSchema.nullable(),
  /** Etapa em que a pessoa foi desclassificada (nome; null sem etapa ou fora de Encerrado). */
  closedStage: z.string().nullable().default(null),
  /** Nota com o e-mail da desclassificação. */
  closedEntryId: IdSchema.nullable().default(null),
  stages: z.array(JobApplicationStageSchema),
  /** Etapa atual do pipeline (o "x" do "x/N"); null antes de começar. */
  currentStageId: IdSchema.nullable(),
  lastActivityAt: IsoDateTimeSchema,
  archivedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type JobApplication = z.infer<typeof JobApplicationSchema>;

/** Linha do quadro e da lista: a candidatura com o resumo da vaga e os contatos (para a busca). */
export const JobApplicationSummarySchema = JobApplicationSchema.extend({
  posting: z.object({
    company: z.string().nullable(),
    client: z.string().nullable(),
    title: z.string().nullable(),
    role: z.string().nullable(),
  }),
  contacts: z.array(z.string()),
  /** "x/N" do pipeline: posição da etapa atual e total de etapas. */
  progress: z.object({ current: z.number().int().min(0), total: z.number().int().min(0) }),
});
export type JobApplicationSummary = z.infer<typeof JobApplicationSummarySchema>;

/** Opções do diálogo "Aplicar": as versões prontas que podem ser travadas e a candidatura ativa, se houver (F07-9). */
export const ApplyOptionSchema = LockedDocumentSchema.extend({
  profileId: IdSchema,
  createdAt: IsoDateTimeSchema,
});
export type ApplyOption = z.infer<typeof ApplyOptionSchema>;

export const ApplyOptionsSchema = z.object({
  cvs: z.array(ApplyOptionSchema),
  coverLetters: z.array(ApplyOptionSchema),
  activeApplicationId: IdSchema.nullable(),
});
export type ApplyOptions = z.infer<typeof ApplyOptionsSchema>;

export const JobApplicationCreateSchema = z.object({
  postingId: IdSchema,
  cvVersionId: IdSchema,
  coverLetterVersionId: IdSchema.nullable().optional(),
  appliedOn: CalendarDateSchema,
});
export type JobApplicationCreate = z.infer<typeof JobApplicationCreateSchema>;

export const JobApplicationPatchSchema = z
  .object({
    column: JobApplicationColumnSchema.optional(),
    closedReason: JobApplicationClosedReasonSchema.nullable().optional(),
    appliedOn: CalendarDateSchema.optional(),
    archived: z.boolean().optional(),
    /** Etapa atual do pipeline (F07/M2); null antes de começar. */
    currentStageId: IdSchema.nullable().optional(),
  })
  .refine((p) => p.column !== "closed" || Boolean(p.closedReason), {
    message: "Encerrar pede o motivo",
    path: ["closedReason"],
  });
export type JobApplicationPatch = z.infer<typeof JobApplicationPatchSchema>;

/** Pipeline editado (F07/M2): a lista em ordem; com `id`, a etapa existente; sem, uma nova. */
export const JobApplicationStagesPutSchema = z.object({
  stages: z
    .array(z.object({ id: IdSchema.optional(), name: z.string().trim().min(1).max(80) }))
    .max(20),
});
export type JobApplicationStagesPut = z.infer<typeof JobApplicationStagesPutSchema>;

/** Candidatura da vaga, para destacar na lista de vagas o que já foi aplicado (a mais recente). */
export const PostingApplicationRefSchema = z.object({
  id: IdSchema,
  column: JobApplicationColumnSchema,
  archived: z.boolean(),
});
export type PostingApplicationRef = z.infer<typeof PostingApplicationRefSchema>;

export const PostingListItemSchema = PostingSchema.extend({
  application: PostingApplicationRefSchema.nullable(),
});
export type PostingListItem = z.infer<typeof PostingListItemSchema>;

/** Cartão da coluna "Vagas salvas" (antes de Aplicado): vaga sem candidatura. */
export const SavedPostingCardSchema = z.object({
  id: IdSchema,
  company: z.string().nullable(),
  client: z.string().nullable(),
  title: z.string().nullable(),
  role: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  archivedAt: IsoDateTimeSchema.nullable(),
  archiveReason: PostingArchiveReasonSchema.nullable(),
});
export type SavedPostingCard = z.infer<typeof SavedPostingCardSchema>;

/** Anexos de até 100 MB por arquivo (F07-11; acima disso, guardar o link na nota). */
export const ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;

export const JobApplicationAttachmentSchema = z.object({
  id: IdSchema,
  fileName: z.string(),
  mime: z.string(),
  size: z.number().int().min(0),
  createdAt: IsoDateTimeSchema,
});
export type JobApplicationAttachment = z.infer<typeof JobApplicationAttachmentSchema>;

/** Nota ou registro datado da candidatura (F07/M3, §0-5): texto e/ou anexos, com a data que a pessoa escolhe. */
export const JobApplicationEntrySchema = z.object({
  id: IdSchema,
  applicationId: IdSchema,
  occurredOn: CalendarDateSchema,
  body: z.string().nullable(),
  attachments: z.array(JobApplicationAttachmentSchema),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type JobApplicationEntry = z.infer<typeof JobApplicationEntrySchema>;

export const JobApplicationEntryPatchSchema = z.object({
  occurredOn: CalendarDateSchema.optional(),
  body: z.string().max(20_000).nullable().optional(),
});
export type JobApplicationEntryPatch = z.infer<typeof JobApplicationEntryPatchSchema>;

/** Tipos de evento da agenda (F07/M5). */
export const JOB_APPLICATION_EVENT_KINDS = [
  "interview",
  "test",
  "deadline",
  "followup",
  "other",
] as const;
export const JobApplicationEventKindSchema = z.enum(JOB_APPLICATION_EVENT_KINDS);
export type JobApplicationEventKind = z.infer<typeof JobApplicationEventKindSchema>;

/** Evento da agenda de uma candidatura: início em UTC com o fuso de quem registrou (F07-3). */
export const JobApplicationEventSchema = z.object({
  id: IdSchema,
  applicationId: IdSchema,
  stageId: IdSchema.nullable(),
  kind: JobApplicationEventKindSchema,
  title: z.string(),
  startsAt: IsoDateTimeSchema,
  durationMin: z.number().int(),
  timezone: z.string(),
  location: z.string().nullable(),
  link: z.string().nullable(),
  notes: z.string().nullable(),
  doneAt: IsoDateTimeSchema.nullable(),
  icsSequence: z.number().int().min(0),
  googleEventId: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type JobApplicationEvent = z.infer<typeof JobApplicationEventSchema>;

const HttpUrl = z
  .string()
  .trim()
  .url()
  .regex(/^https?:\/\//i, "Use um link http(s)");
/** Data e hora como a pessoa digita no fuso dela (`datetime-local`). */
export const LocalDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use YYYY-MM-DDTHH:mm");

export const JobApplicationEventInputSchema = z.object({
  kind: JobApplicationEventKindSchema,
  title: z.string().trim().min(1).max(120),
  startsLocal: LocalDateTimeSchema,
  timezone: TimeZoneSchema,
  durationMin: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(60),
  stageId: IdSchema.nullable().optional(),
  location: z.string().trim().max(300).nullable().optional(),
  link: HttpUrl.nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});
export type JobApplicationEventInput = z.input<typeof JobApplicationEventInputSchema>;

export const JobApplicationEventPatchSchema = JobApplicationEventInputSchema.partial()
  .extend({ done: z.boolean().optional() })
  .refine((p) => (p.startsLocal === undefined) === (p.timezone === undefined), {
    message: "Data e hora vêm com o fuso",
    path: ["timezone"],
  });
export type JobApplicationEventPatch = z.infer<typeof JobApplicationEventPatchSchema>;

/** Lembrete: o evento com a candidatura (empresa e cargo) para a bandeja e o badge. */
export const JobApplicationReminderSchema = z.object({
  event: JobApplicationEventSchema,
  application: z.object({
    id: IdSchema,
    company: z.string().nullable(),
    title: z.string().nullable(),
  }),
});
export type JobApplicationReminder = z.infer<typeof JobApplicationReminderSchema>;

export const JobApplicationUpcomingSchema = z.object({
  upcoming: z.array(JobApplicationReminderSchema),
  overdue: z.array(JobApplicationReminderSchema),
});
export type JobApplicationUpcoming = z.infer<typeof JobApplicationUpcomingSchema>;

/** Funil (F07/M5): agora em cada coluna, quantas chegaram a ela, dias médios e a taxa de avanço. */
export const JobApplicationFunnelSchema = z.object({
  total: z.number().int(),
  columns: z.array(
    z.object({
      column: JobApplicationColumnSchema,
      now: z.number().int(),
      reached: z.number().int(),
      avgDays: z.number().nullable(),
    }),
  ),
  rates: z.array(
    z.object({
      from: JobApplicationColumnSchema,
      to: JobApplicationColumnSchema,
      rate: z.number().nullable(),
    }),
  ),
  closedReasons: z.partialRecord(JobApplicationClosedReasonSchema, z.number().int()),
  /** Desclassificações por etapa (nome da etapa; as sem etapa ficam de fora). */
  rejectedByStage: z.record(z.string(), z.number().int()).default({}),
});
export type JobApplicationFunnel = z.infer<typeof JobApplicationFunnelSchema>;

/** Desclassificação (2026-10-29): o e-mail colado vira nota; a etapa é a do pipeline (null: sem etapa). */
export const JobApplicationRejectSchema = z.object({
  occurredOn: CalendarDateSchema,
  message: z.string().trim().min(1).max(20_000),
  stageId: IdSchema.nullable(),
});
export type JobApplicationReject = z.infer<typeof JobApplicationRejectSchema>;
