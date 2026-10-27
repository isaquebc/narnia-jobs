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

/** Resultado da comparação de duplicata (F06-9) e a decisão do usuário no modal. */
export const PostingDuplicateCheckSchema = z.object({
  candidateId: IdSchema,
  sameJob: z.boolean(),
  confidence: z.number().int().min(0).max(100),
  differences: z.array(z.object({ field: z.string(), saved: z.string(), incoming: z.string() })),
  rationale: z.string(),
  checkedAt: IsoDateTimeSchema,
  decision: z.enum(["update", "new", "cancel"]).nullable(),
});
export type PostingDuplicateCheck = z.infer<typeof PostingDuplicateCheckSchema>;

/**
 * Por que a pessoa arquivou a vaga (F07, pedido do dono 2026-10-27: "não deu um bom fit"). Fica guardado para o
 * recrutador aprender o que ela descarta e calibrar o fit das próximas vagas.
 */
export const PostingArchiveReasonSchema = z.enum([
  "salary",
  "seniority",
  "stack",
  "work_mode",
  "location",
  "contract",
  "company",
  "other",
]);
export type PostingArchiveReason = z.infer<typeof PostingArchiveReasonSchema>;

export const PostingArchiveRequestSchema = z.object({
  reason: PostingArchiveReasonSchema,
  note: z.string().trim().max(2000).nullable().optional(),
});
export type PostingArchiveRequest = z.infer<typeof PostingArchiveRequestSchema>;

export const PostingSchema = PostingFieldsSchema.extend({
  id: IdSchema,
  status: PostingStatusSchema,
  identityHash: z.string().nullable(),
  fieldSources: z.record(z.string(), FieldSourceSchema),
  /** Pré-análise da heurística local (M3): keywords, seções, riscos. Formato em `posting-analysis.ts`. */
  preAnalysis: z.unknown().nullable(),
  /** Snapshot do HTML buscado pela URL (M4), relativo à pasta de dados. */
  rawPath: z.string().nullable(),
  /** Comparação com a vaga salva de mesmo hash (F06-9); null sem candidata. */
  duplicate: PostingDuplicateCheckSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  /**
   * Última mudança de conteúdo (edição do usuário ou texto da vaga novo): é com ela que a análise envelhece (F06-10).
   * Status e campos preenchidos pela extração não contam.
   */
  contentUpdatedAt: IsoDateTimeSchema,
  /** Arquivada pela pessoa (sai da lista e da coluna "Vagas salvas"), com o motivo. */
  archivedAt: IsoDateTimeSchema.nullable().default(null),
  archiveReason: PostingArchiveReasonSchema.nullable().default(null),
  archiveNote: z.string().nullable().default(null),
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

/**
 * Link de perfil do LinkedIn (2026-10-19): só `linkedin.com` (e subdomínios), com caminho; sai sem query, sem barra
 * final e com https. Inválido devolve null.
 */
export function normalizeLinkedinUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
  const path = u.pathname.replace(/\/+$/, "");
  if (!path || path === "/") return null;
  return `https://${host}${path}`;
}

const LinkedinUrl = z.string().transform((v, ctx) => {
  const url = normalizeLinkedinUrl(v);
  if (!url) {
    ctx.addIssue({ code: "custom", message: "Link do LinkedIn inválido" });
    return z.NEVER;
  }
  return url;
});

export const PostingContactInputSchema = z.object({
  name: Text,
  origin: ContactOriginSchema,
  linkedinUrl: LinkedinUrl.nullable().optional(),
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
  linkedinUrl: z.string().nullable(),
  /** Fixado no topo da página da vaga (um por vaga; fora do limite dos dois últimos). */
  pinned: z.boolean(),
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

/* ---------- pré-análise (heurística local, M3) ---------- */

export const EVIDENCE_KINDS = [
  "experience",
  "achievement",
  "project",
  "skill",
  "education",
  "language",
] as const;
export const EvidenceKindSchema = z.enum(EVIDENCE_KINDS);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

/** Evidência de um fato do usuário (F06 §2.0: o id só é único junto com o tipo). */
export const EvidenceRefSchema = z.object({
  kind: EvidenceKindSchema,
  id: IdSchema,
  label: z.string(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const KeywordSectionSchema = z.enum(["required", "nice", "other"]);

export const PreAnalysisKeywordSchema = z.object({
  term: z.string(),
  category: z.string(),
  section: KeywordSectionSchema,
  count: z.number().int().min(0),
  /** Quem achou o termo na vaga (F06-6): heurística, modelo ou os dois. */
  source: FieldSourceSchema,
  /** Fatos do usuário que têm o termo (dicionário ou busca FTS); vazio = sem evidência local. */
  evidence: z.array(EvidenceRefSchema),
});
export type PreAnalysisKeyword = z.infer<typeof PreAnalysisKeywordSchema>;

export const RiskTypeSchema = z.enum([
  "seniority",
  "location",
  "work_mode",
  "contract",
  "salary",
  "language",
]);
export type RiskType = z.infer<typeof RiskTypeSchema>;

export const PostingRiskSchema = z.object({
  type: RiskTypeSchema,
  description: z.string(),
  source: z.enum(["heuristic", "model"]),
});
export type PostingRisk = z.infer<typeof PostingRiskSchema>;

export const PreAnalysisSchema = z.object({
  version: z.literal(1),
  keywords: z.array(PreAnalysisKeywordSchema),
  /** Termos com cara de tecnologia fora do dicionário (revisão e ampliação do dicionário). */
  ngrams: z.array(z.string()),
  sectionsDetected: z.boolean(),
  yearsMin: z.number().int().nullable(),
  /** Obrigatórios com evidência / obrigatórios (0–1); null sem obrigatórios. */
  coverage: z.number().min(0).max(1).nullable(),
  /** Riscos por perfil não arquivado (preferências de cada um). */
  risksByProfile: z.record(z.string(), z.array(PostingRiskSchema)),
  createdAt: IsoDateTimeSchema,
});
export type PreAnalysis = z.infer<typeof PreAnalysisSchema>;

/* ---------- saídas dos modelos (M4) ---------- */

/** Palavra-chave que o modelo achou na vaga, com a seção (obrigatório, diferencial, outro). */
export const ModelKeywordSchema = z.object({
  term: z.string().min(1),
  section: KeywordSectionSchema,
});

/** Extração da vaga pelo modelo barato (F06-5: Haiku), independente da heurística (F06-6). */
export const PostingExtractOutputSchema = z.object({
  fields: PostingFieldsSchema,
  keywords: z.array(ModelKeywordSchema),
});
export type PostingExtractOutput = z.infer<typeof PostingExtractOutputSchema>;

/**
 * Merge da heurística com a extração do modelo (F06-6), feito por outro agente: campos finais, a origem de cada um e
 * as palavras-chave com quem as achou. Origem em lista (schema de saída estruturada não tem chave dinâmica).
 */
export const PostingMergeOutputSchema = z.object({
  fields: PostingFieldsSchema,
  fieldSources: z.array(
    z.object({
      field: z.enum(POSTING_FIELD_NAMES as [PostingFieldName, ...PostingFieldName[]]),
      source: z.enum(["heuristic", "model", "both"]),
    }),
  ),
  keywords: z.array(ModelKeywordSchema.extend({ source: z.enum(["heuristic", "model", "both"]) })),
});
export type PostingMergeOutput = z.infer<typeof PostingMergeOutputSchema>;

/** Comparação de duas vagas com o mesmo hash de identidade (F06-9): mesma vaga? com que certeza? o que muda? */
export const PostingDuplicateOutputSchema = z.object({
  sameJob: z.boolean(),
  confidence: z.number().int().min(0).max(100),
  differences: z.array(
    z.object({ field: z.string().min(1), saved: z.string(), incoming: z.string() }),
  ),
  rationale: z.string().min(1),
});
export type PostingDuplicateOutput = z.infer<typeof PostingDuplicateOutputSchema>;

/* ---------- modelos por tarefa (F06-5, F06-13) ---------- */

/** Só modelos do Claude por enquanto (F06-13); outros provedores entram com a F11. */
export const CLAUDE_MODELS = ["haiku", "sonnet", "opus"] as const;
export const ClaudeModelSchema = z.enum(CLAUDE_MODELS);

export const POSTING_MODEL_KEYS = [
  "posting_extract",
  "posting_merge",
  "posting_duplicate",
  "posting_analyze",
  // F05-13: Sonnet gera o CV e a carta; Haiku revisa
  "cv_generate",
  "cv_review",
  // F12/M3: Haiku organiza as perguntas do formulário de candidatura
  "application_locate",
  // F12/M4: Sonnet escreve as respostas sugeridas
  "application_answer",
] as const;
export const PostingModelsSchema = z.object(
  Object.fromEntries(POSTING_MODEL_KEYS.map((k) => [k, ClaudeModelSchema])) as Record<
    (typeof POSTING_MODEL_KEYS)[number],
    typeof ClaudeModelSchema
  >,
);
export type PostingModels = z.infer<typeof PostingModelsSchema>;
