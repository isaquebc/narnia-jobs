import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common";
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
  })
  .refine((p) => p.column !== "closed" || Boolean(p.closedReason), {
    message: "Encerrar pede o motivo",
    path: ["closedReason"],
  });
export type JobApplicationPatch = z.infer<typeof JobApplicationPatchSchema>;

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
