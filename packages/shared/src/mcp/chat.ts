import { z } from "zod";
import { toJsonSchema } from "../json-schema";
import {
  ChatCategorySchema,
  ChatSessionStateSchema,
  FactSearchKindSchema,
  TrustTagSchema,
} from "../schemas/chat";
import { IdSchema, PartialDateSchema } from "../schemas/common";
import { IngestionDepthSchema, IngestionModeSchema, RunStatusSchema } from "../schemas/ingest";
import type { ToolDefinition } from "./profile";

/**
 * Tools MCP novas da F04 (§2.3): definição aqui; handlers puros em `packages/core/src/chat/tools.ts`; exposição pelo
 * servidor MCP no M2. Listas devolvem uma linha por item com paginação (`limit`/`cursor`); detalhe só no `get`.
 */
const tool = <I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  description: string,
  input: I,
  output: O,
): ToolDefinition<I, O> => ({ description, input, output });

const Page = z.object({
  limit: z.number().int().min(1).max(50).optional(),
  cursor: z.string().min(1).optional(),
});
/** Linha compacta (30–40 tokens): o que o agente precisa para decidir se pede o detalhe. */
const Line = z.object({
  id: IdSchema,
  line: z.string(),
  relevance: z.number().min(0).max(1).nullable(),
});
const Paged = z.object({ items: z.array(Line), nextCursor: z.string().nullable() });
const ById = z.object({ id: IdSchema });
const Detail = z.object({
  id: IdSchema,
  kind: z.string(),
  detail: z.record(z.string(), z.unknown()),
});

const IngestStarted = z.object({
  runId: IdSchema,
  status: RunStatusSchema,
  estimatedTokens: z.number().int().min(0),
  needsConfirmation: z.boolean(),
  url: z.string().min(1),
});
const FREE_TEXT_MIN = 200;
const FREE_TEXT_MAX = 50_000;

export const CHAT_TOOLS = {
  "evidence.experience.list": tool(
    "Experiências do usuário, uma linha cada (empresa · cargo · período), ordenadas pela relevância do perfil da sessão.",
    Page,
    Paged,
  ),
  "evidence.experience.get": tool(
    "Detalhe de uma experiência: resumo, tecnologias, conquistas com métrica, verificação e fontes.",
    ById,
    Detail,
  ),
  "evidence.project.list": tool(
    "Projetos do usuário, uma linha cada (nome · papel · período), ordenados pela relevância do perfil.",
    Page,
    Paged,
  ),
  "evidence.project.get": tool("Detalhe de um projeto.", ById, Detail),
  "evidence.skill.list": tool(
    "Skills do usuário, uma linha cada (nome · categoria · nível), ordenadas pela relevância do perfil.",
    Page,
    Paged,
  ),
  "evidence.education.list": tool(
    "Formação do usuário, uma linha cada (instituição · curso · período).",
    Page,
    Paged,
  ),
  "fact.search": tool(
    "Busca nos fatos e resumos do usuário sem ler tudo (acentos ignorados, prefixo). Use antes de listar.",
    z.object({
      q: z.string().trim().min(2).max(200),
      kinds: z.array(FactSearchKindSchema).min(1).optional(),
      from: PartialDateSchema.optional(),
      to: PartialDateSchema.optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    z.object({
      items: z.array(
        z.object({
          kind: FactSearchKindSchema,
          id: IdSchema,
          line: z.string(),
          period: z.string().nullable(),
          relevance: z.number().min(0).max(1).nullable(),
        }),
      ),
      total: z.number().int().min(0),
    }),
  ),
  "fact.get": tool(
    "Detalhe de até 10 fatos pelo tipo e id (os devolvidos pela busca).",
    z.object({
      refs: z
        .array(z.object({ kind: FactSearchKindSchema, id: IdSchema }))
        .min(1)
        .max(10),
    }),
    z.object({ items: z.array(Detail) }),
  ),
  "fact.timeline": tool(
    "Linha do tempo de experiências, projetos e formação num período (YYYY ou YYYY-MM).",
    z.object({ from: PartialDateSchema, to: PartialDateSchema.optional() }),
    z.object({
      items: z.array(
        z.object({
          kind: FactSearchKindSchema,
          id: IdSchema,
          line: z.string(),
          start: z.string().nullable(),
          end: z.string().nullable(),
        }),
      ),
    }),
  ),
  "fact.unverified": tool(
    "Fatos ainda não verificados pelo usuário, uma linha cada (para revisar com ele).",
    Page,
    z.object({
      items: z.array(z.object({ kind: FactSearchKindSchema, id: IdSchema, line: z.string() })),
      nextCursor: z.string().nullable(),
    }),
  ),
  "fact.verify": tool(
    "Marca um fato como verificado depois que o usuário confirmou na conversa.",
    z.object({ kind: FactSearchKindSchema.exclude(["file", "repo"]), id: IdSchema }),
    z.object({ ok: z.literal(true) }),
  ),
  "research.save": tool(
    "Registra uma fonte pesquisada (só domínios confiáveis); o valor só vira dado do usuário depois de confirmado.",
    z.object({
      url: z.string().url(),
      title: z.string().min(1).max(300),
      excerpt: z.string().min(1).max(2_000),
      usedFor: z.string().min(1).max(100),
    }),
    z.object({ id: IdSchema, domain: z.string(), trustTag: TrustTagSchema }),
  ),
  "research.list": tool(
    "Fontes já pesquisadas para o perfil da sessão, uma linha cada.",
    Page,
    Paged,
  ),
  "job.status": tool(
    "Estado de um job em segundo plano (ingestão, análise).",
    z.object({ jobId: IdSchema }),
    z.object({
      id: IdSchema,
      type: z.string(),
      status: z.string(),
      stage: z.string(),
      progress: z.number().min(0).max(100),
      error: z.string().nullable(),
    }),
  ),
  "job.list": tool("Jobs recentes, uma linha cada (tipo · estado · progresso).", Page, Paged),
  "session.get": tool(
    "Dados da sessão de chat atual: categoria, perfil, modelo e execução ligada (clarificação).",
    z.object({}),
    z.object({
      id: IdSchema,
      profileId: IdSchema,
      category: ChatCategorySchema,
      model: z.string(),
      state: ChatSessionStateSchema,
      ingestionRunId: IdSchema.nullable(),
    }),
  ),
  "session.set_category": tool(
    "Muda a categoria da sessão atual (muda o conjunto de tools disponível).",
    z.object({ category: ChatCategorySchema }),
    z.object({ ok: z.literal(true) }),
  ),
  "usage.log": tool(
    "Registra o uso de um turno no modo terminal; ignorado se o mesmo turno já foi registrado.",
    z.object({
      providerSessionId: z.string().min(1),
      turnIndex: z.number().int().min(0),
      model: z.string().min(1),
      inputTokens: z.number().int().min(0),
      outputTokens: z.number().int().min(0),
      cacheRead: z.number().int().min(0).optional(),
      cacheWrite: z.number().int().min(0).optional(),
      costUsd: z.number().min(0).optional(),
    }),
    z.object({ recorded: z.boolean() }),
  ),
  "ingest.text": tool(
    "Ingere um texto de carreira enviado na conversa: cria uma execução cujas propostas vão para a revisão (nada é gravado direto).",
    z.object({ text: z.string().min(FREE_TEXT_MIN).max(FREE_TEXT_MAX) }),
    IngestStarted.extend({ alreadyRead: z.boolean() }),
  ),
  "ingest.file": tool(
    "Ingere um arquivo (currículo, PDF) já anexado à conversa: cria uma execução cujas propostas vão para a revisão.",
    z.object({ fileId: IdSchema }),
    IngestStarted.extend({ alreadyRead: z.boolean() }),
  ),
  "ingest.github": tool(
    "Prepara a análise de repositórios do GitHub; sempre espera o usuário confirmar o orçamento na tela da execução.",
    z.object({
      mode: IngestionModeSchema,
      repos: z.array(z.string().min(3)).min(1).max(100),
      depth: IngestionDepthSchema,
      model: z.string().min(1).optional(),
      login: z.string().min(1).max(39).optional(),
    }),
    IngestStarted,
  ),
} as const;

export type ChatToolName = keyof typeof CHAT_TOOLS;

export const CHAT_TOOL_JSON_SCHEMAS = Object.fromEntries(
  (Object.keys(CHAT_TOOLS) as ChatToolName[]).map((name) => [
    name,
    {
      description: CHAT_TOOLS[name].description,
      input: toJsonSchema(CHAT_TOOLS[name].input),
      output: toJsonSchema(CHAT_TOOLS[name].output),
    },
  ]),
) as Record<ChatToolName, { description: string; input: unknown; output: unknown }>;
