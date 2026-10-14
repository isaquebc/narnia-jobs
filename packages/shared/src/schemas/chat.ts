import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common";

/** F04 §3: categorias de sessão (definem o escopo de tools, F04-2) e estados de uma sessão de chat. */
/** `discovery` (auditoria E2): entrevista de descoberta do primeiro uso, só sobre as lacunas do perfil. */
export const ChatCategorySchema = z.enum(["career", "clarify", "ingest", "interview", "discovery"]);
export type ChatCategory = z.infer<typeof ChatCategorySchema>;

export const ChatSessionStateSchema = z.enum(["live", "hibernated", "archived", "error"]);
export type ChatSessionState = z.infer<typeof ChatSessionStateSchema>;

export const ChatSessionSchema = z.object({
  id: IdSchema,
  profileId: IdSchema,
  category: ChatCategorySchema,
  title: z.string(),
  provider: z.string().min(1),
  providerSessionId: z.string().nullable(),
  model: z.string().min(1),
  state: ChatSessionStateSchema,
  ingestionRunId: IdSchema.nullable(),
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
});
export type ChatToolCall = z.infer<typeof ChatToolCallSchema>;

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
