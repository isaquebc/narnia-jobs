import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common";

/** F04 §3: categorias de sessão (definem o escopo de tools, F04-2) e estados de uma sessão de chat. */
/** `discovery` (auditoria E2): entrevista de descoberta do primeiro uso, só sobre as lacunas do perfil. */
/** `job` (F06): análise de uma vaga, numa conversa própria com o título da vaga. */
export const ChatCategorySchema = z.enum([
  "career",
  "clarify",
  "ingest",
  "interview",
  "discovery",
  "job",
]);
export type ChatCategory = z.infer<typeof ChatCategorySchema>;

export const ChatSessionStateSchema = z.enum(["live", "hibernated", "archived", "error"]);
export type ChatSessionState = z.infer<typeof ChatSessionStateSchema>;

export const ChatSessionSchema = z.object({
  id: IdSchema,
  /**
   * Recrutador global (F06-8): a conversa não pertence a um perfil. Aqui fica só o perfil em foco quando ela nasceu
   * (contexto); null = conversa sem perfil, ou perfil apagado.
   */
  profileId: IdSchema.nullable(),
  category: ChatCategorySchema,
  title: z.string(),
  provider: z.string().min(1),
  providerSessionId: z.string().nullable(),
  model: z.string().min(1),
  state: ChatSessionStateSchema,
  ingestionRunId: IdSchema.nullable(),
  /** Vaga tratada pela conversa da análise (categoria `job`, F06). */
  postingId: IdSchema.nullable().optional(),
  cardHash: z.string().nullable(),
  tokensIn: z.number().int().min(0),
  tokensOut: z.number().int().min(0),
  costUsdEst: z.number().min(0),
  createdAt: IsoDateTimeSchema,
  lastActivityAt: IsoDateTimeSchema,
  /**
   * Turno em andamento no processo do api (auditoria B): a web deriva o "pensando" daqui depois de recarregar ou
   * reconectar. Só nas respostas da api; ausente no banco.
   */
  busy: z.boolean().optional(),
  /** Mensagens do recrutador ou do sistema depois da última lida pelo usuário (ponto verde no menu, 2026-10-13). */
  unread: z.number().int().min(0).optional(),
});
export type ChatSession = z.infer<typeof ChatSessionSchema>;

export const ChatRoleSchema = z.enum(["user", "assistant", "system_note"]);

/** Tool call resumida (sem payload completo, F04 §3): nome, argumentos curtos, duração e se deu erro. */
export const ChatToolCallSchema = z.object({
  name: z.string().min(1),
  args: z.string().max(500),
  durationMs: z.number().int().min(0).nullable(),
  isError: z.boolean(),
  /** Execução criada por esta tool (ingest_text/file/github): o link "Abrir a ingestão criada" sobrevive ao reload. */
  runId: IdSchema.optional(),
  /** F06: conversa da análise aberta por esta tool (`posting_open_analysis`). */
  sessionId: IdSchema.optional(),
  /** F06: vaga criada ou analisada por esta tool (`posting_create`, `analysis_save`). */
  postingId: IdSchema.optional(),
  /** F05: documentos (CV, carta) criados ou alterados por esta tool (`cv_generate`, `cv_edit`). */
  documents: z
    .array(z.object({ id: IdSchema, kind: z.enum(["cv", "cover_letter"]), url: z.string() }))
    .optional(),
  /** F05: botão sugerido pelo recrutador (`ui_suggest_action`), já validado pelo servidor. */
  action: z.object({ label: z.string(), url: z.string() }).optional(),
  /** Chamada feita pelo recrutador especializado (subagente, F06-8), não pelo recrutador da conversa. */
  subagent: z.boolean().optional(),
});
export type ChatToolCall = z.infer<typeof ChatToolCallSchema>;

/**
 * Citação da resposta conferida pelo código (F04-fix-fundamentacao, R5): `f` fato, `r` pesquisa, `v` vaga; o balão da
 * conversa mostra o rótulo e o link; `valid: false` é id que não existe.
 */
export const ChatCitationSchema = z.object({
  kind: z.enum(["f", "r", "v"]),
  ref: z.string(),
  valid: z.boolean(),
  label: z.string().nullable(),
  detail: z.string().nullable(),
  url: z.string().nullable(),
});
export type ChatCitation = z.infer<typeof ChatCitationSchema>;

export const ChatMessageSchema = z.object({
  id: IdSchema,
  sessionId: IdSchema,
  turnIndex: z.number().int().min(0),
  role: ChatRoleSchema,
  contentMd: z.string(),
  toolCalls: z.array(ChatToolCallSchema),
  usage: z
    .object({ inputTokens: z.number().int().min(0), outputTokens: z.number().int().min(0) })
    .nullable(),
  createdAt: IsoDateTimeSchema,
  /** Só nas respostas lidas pela API: citações conferidas e frases com dado checável sem citação (R5). */
  citations: z.array(ChatCitationSchema).optional(),
  uncited: z.array(z.string()).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** Título da conversa escolhido pelo modelo mais barato a partir da primeira mensagem (2026-10-13). */
export const ChatTitleOutputSchema = z.object({ title: z.string().min(2).max(60) });
export type ChatTitleOutput = z.infer<typeof ChatTitleOutputSchema>;

/** Valor de `title` enquanto a conversa não tem tema (só até a primeira resposta). */
export const DEFAULT_CHAT_TITLE = "Nova conversa";

/** Rótulo de confiança da fonte pesquisada (F04-5). */
export const TrustTagSchema = z.enum(["official", "survey", "jobboard", "other"]);
export type TrustTag = z.infer<typeof TrustTagSchema>;

/**
 * Domínio confiável para pesquisa (F04-5): domínio exato (`ibge.gov.br`) ou com máscara `*` só como primeiro rótulo
 * (`*.gov.br`) ou último rótulo inteiro (`glassdoor.*`). Sem esquema nem caminho.
 */
export const DOMAIN_PATTERN = /^(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+(\.\*)?$/;
export const TrustedDomainSchema = z.object({
  id: IdSchema,
  pattern: z
    .string()
    // normaliza antes de validar (auditoria A): maiúsculas e `www.` não viram erro nem padrão que nunca casa
    .trim()
    .toLowerCase()
    .overwrite((p) => p.replace(/^www\./, ""))
    .min(3)
    .max(253)
    .regex(DOMAIN_PATTERN, "Domínio como ibge.gov.br, *.gov.br ou glassdoor.*")
    .refine((p) => !(p.startsWith("*.") && p.endsWith(".*")), "Use só uma máscara"),
  trustTag: TrustTagSchema,
  builtin: z.boolean(),
  enabled: z.boolean(),
  createdAt: IsoDateTimeSchema,
});
export type TrustedDomain = z.infer<typeof TrustedDomainSchema>;

export const ResearchSourceSchema = z.object({
  id: IdSchema,
  profileId: IdSchema.nullable(),
  sessionId: IdSchema.nullable(),
  url: z.string().url(),
  domain: z.string(),
  title: z.string(),
  excerpt: z.string(),
  usedFor: z.string().min(1),
  trustTag: TrustTagSchema,
  /** Fonte fora da lista de domínios confiáveis, usada porque o usuário confirmou na conversa (F04-5). */
  userConfirmed: z.boolean().default(false),
  accepted: z.boolean().nullable(),
  accessedAt: IsoDateTimeSchema,
});
export type ResearchSource = z.infer<typeof ResearchSourceSchema>;

/** Tipos indexados na busca de fatos (FTS5, F04 §3): fatos e resumos de arquivos e repositórios. */
export const FACT_SEARCH_KINDS = [
  "experience",
  "achievement",
  "project",
  "skill",
  "education",
  "language",
  "file",
  "repo",
] as const;
export const FactSearchKindSchema = z.enum(FACT_SEARCH_KINDS);
export type FactSearchKind = z.infer<typeof FactSearchKindSchema>;

/** Termo aprendido pela busca de fatos (F04-fix-fundamentacao, FF-1), com o rótulo do fato (null: fato apagado). */
export const FactAliasSchema = z.object({
  id: z.string(),
  term: z.string(),
  kind: FactSearchKindSchema,
  factId: z.string(),
  factLabel: z.string().nullable(),
  sessionId: z.string().nullable(),
  createdAt: z.string(),
});
export type FactAliasDto = z.infer<typeof FactAliasSchema>;
