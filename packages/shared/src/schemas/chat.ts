import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common";

/** F04 §3: categorias de sessão (definem o escopo de tools, F04-2) e estados de uma sessão de chat. */
export const ChatCategorySchema = z.enum(["career", "clarify", "ingest", "interview"]);
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
});
export type ChatSession = z.infer<typeof ChatSessionSchema>;

export const ChatRoleSchema = z.enum(["user", "assistant", "system_note"]);

/** Tool call resumida (sem payload completo, F04 §3): nome, argumentos curtos, duração e se deu erro. */
export const ChatToolCallSchema = z.object({
  name: z.string().min(1),
  args: z.string().max(500),
  durationMs: z.number().int().min(0).nullable(),
  isError: z.boolean(),
});

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
