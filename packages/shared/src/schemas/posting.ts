import { z } from "zod";
import {
  IdSchema,
  IsoCurrencySchema,
  IsoDateTimeSchema,
  PartialDateSchema,
  UrlSchema,
} from "./common";
import { ContractTypeSchema, SalaryPeriodSchema } from "./profile";

/**
 * Vaga analisada (F06 §1.1, §3). Os dados chegam aos poucos (§1.2): quase tudo é opcional e a vaga é editável. O
 * domínio se chama `posting` porque `job` já é a fila de tarefas.
 */

/** Senioridade publicada na vaga (F06-12: campo próprio, separado do cargo e da role). */
export const PostingSenioritySchema = z.enum([
  "intern",
  "junior",
  "pleno",
  "senior",
  "staff",
  "lead",
  "manager",
  "director",
]);
export type PostingSeniority = z.infer<typeof PostingSenioritySchema>;

/** Role normalizada (F06-12): lista curada, a mesma da heurística e da extração pelo modelo. */
export const POSTING_ROLES = [
  "backend",
  "frontend",
  "fullstack",
  "mobile",
  "data_engineering",
  "data_science",
  "ml_engineering",
  "devops_sre",
  "platform",
  "qa",
  "security",
  "embedded",
  "architect",
  "tech_lead",
  "engineering_manager",
  "product_management",
  "product_design",
  "support",
  "other",
] as const;
export const PostingRoleSchema = z.enum(POSTING_ROLES);
export type PostingRole = z.infer<typeof PostingRoleSchema>;

export const PostingWorkModeSchema = z.enum(["remote", "hybrid", "onsite"]);
export type PostingWorkMode = z.infer<typeof PostingWorkModeSchema>;

/** Estado da vaga no pipeline (M4): rascunho → extraindo → pronta; erro mantém o que já foi salvo. */
export const PostingStatusSchema = z.enum(["draft", "extracting", "ready", "error"]);
export type PostingStatus = z.infer<typeof PostingStatusSchema>;

/** De onde veio cada campo (F06-6): heurística, modelo, os dois concordando, ou o usuário. */
export const FieldSourceSchema = z.enum(["heuristic", "model", "both", "user"]);
export type FieldSource = z.infer<typeof FieldSourceSchema>;

const Text = z.string().trim().min(1);
const TextList = z.array(Text).default([]);

/** Campos editáveis da vaga (o que o usuário, o recrutador e a extração preenchem). */
export const PostingFieldsSchema = z.object({
  company: Text.nullable(),
  client: Text.nullable(),
  title: Text.nullable(),
  role: PostingRoleSchema.nullable(),
  seniority: PostingSenioritySchema.nullable(),
  city: Text.nullable(),
  state: Text.nullable(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  workMode: PostingWorkModeSchema.nullable(),
  contractType: ContractTypeSchema.nullable(),
  currency: IsoCurrencySchema.nullable(),
  salaryMin: z.number().min(0).nullable(),
  salaryMax: z.number().min(0).nullable(),
  salaryPeriod: SalaryPeriodSchema.nullable(),
  benefits: TextList,
  responsibilities: TextList,
  skillsRequired: TextList,
  skillsNice: TextList,
  companySummary: Text.nullable(),
  postingUrl: UrlSchema.nullable(),
  companyUrl: UrlSchema.nullable(),
  jdText: Text.nullable(),
  publishedAt: PartialDateSchema.nullable(),
});
export type PostingFields = z.infer<typeof PostingFieldsSchema>;
export type PostingFieldName = keyof PostingFields;
export const POSTING_FIELD_NAMES = Object.keys(PostingFieldsSchema.shape) as PostingFieldName[];

/** Campos que identificam a vaga (F06-2, F06-9): sem a data de publicação. */
export const POSTING_IDENTITY_FIELDS = ["company", "client", "title", "role"] as const;

export const PostingSchema = PostingFieldsSchema.extend({
  id: IdSchema,
  status: PostingStatusSchema,
  identityHash: z.string().nullable(),
  fieldSources: z.record(z.string(), FieldSourceSchema),
  /** Pré-análise da heurística local (M3): keywords, seções, riscos. Formato em `posting-analysis.ts`. */
  preAnalysis: z.unknown().nullable(),
  /** Snapshot do HTML buscado pela URL (M4), relativo à pasta de dados. */
  rawPath: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Posting = z.infer<typeof PostingSchema>;

/** Criação: os campos que já se sabem; nenhum é obrigatório sozinho, mas a vaga precisa de algum dado (§1.2). */
export const PostingCreateSchema = PostingFieldsSchema.partial()
  .extend({ fieldSources: z.record(z.string(), FieldSourceSchema).optional() })
  .refine(
    (v) => Boolean(v.company || v.title || v.role || v.jdText || v.postingUrl),
    "Informe ao menos a empresa, o cargo, a role, a descrição ou o link da vaga.",
  );
export type PostingCreate = z.infer<typeof PostingCreateSchema>;

export const PostingPatchSchema = PostingFieldsSchema.partial();
export type PostingPatch = z.infer<typeof PostingPatchSchema>;

export const ContactOriginSchema = z.enum(["linkedin", "whatsapp", "email", "other"]);
export type ContactOrigin = z.infer<typeof ContactOriginSchema>;

export const PostingContactInputSchema = z.object({
  name: Text,
  origin: ContactOriginSchema,
  email: z.email().nullable().optional(),
  phone: z
    .string()
    .trim()
    .regex(/^[+\d][\d\s().-]{6,}$/, "Telefone inválido")
    .nullable()
    .optional(),
});
export type PostingContactInput = z.infer<typeof PostingContactInputSchema>;

export const PostingContactSchema = z.object({
  id: IdSchema,
  postingId: IdSchema,
  name: z.string(),
  origin: ContactOriginSchema,
  email: z.string().nullable(),
  phone: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type PostingContact = z.infer<typeof PostingContactSchema>;

export const NoteAuthorSchema = z.enum(["user", "recruiter"]);
export type NoteAuthor = z.infer<typeof NoteAuthorSchema>;

/**
 * Nota da vaga (§1.3, F06-17): usuário e recrutador escrevem. Edição do recrutador numa nota do usuário fica em
 * `pendingBody` até o usuário confirmar (bandeja "Aguardando você" e Pendências); até lá vale `body`.
 */
export const PostingNoteSchema = z.object({
  id: IdSchema,
  postingId: IdSchema,
  author: NoteAuthorSchema,
  body: z.string(),
  pendingBody: z.string().nullable(),
  pendingAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type PostingNote = z.infer<typeof PostingNoteSchema>;

export const PostingNoteInputSchema = z.object({ body: Text });
