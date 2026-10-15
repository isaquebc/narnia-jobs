import { z } from "zod";
import { toJsonSchema } from "../json-schema";
import { JobAnalysisSchema } from "../schemas/analysis";
import { IdSchema } from "../schemas/common";
import { ContactOriginSchema, PostingFieldsSchema, PostingStatusSchema } from "../schemas/posting";
import type { ToolDefinition } from "./profile";

/**
 * Tools da vaga e da análise (F06 §2.4): definição aqui; handlers em `packages/core/src/postings/tools.ts`, com as
 * portas da api (busca por URL, fila, conversa nova). O recrutador completa a vaga aos poucos pela conversa (§1.2).
 */
const tool = <I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  description: string,
  input: I,
  output: O,
): ToolDefinition<I, O> => ({ description, input, output });

const Fields = PostingFieldsSchema.partial();
const Line = z.object({ id: IdSchema, line: z.string() });
/** Termo da vaga com as primeiras evidências locais (tipo, id e rótulo do fato) que a busca sem tokens achou. */
const BriefTerm = z.object({
  term: z.string(),
  evidence: z.array(z.object({ kind: z.string(), id: IdSchema, label: z.string() })),
});
const PreAnalysisBrief = z.object({
  required: z.array(BriefTerm),
  nice: z.array(BriefTerm),
  coverage: z.number().nullable(),
  risks: z.array(z.string()),
});

export const POSTING_TOOLS = {
  "posting.create": tool(
    "Salva uma vaga (sempre: salvar não é se candidatar) a partir do texto colado, do link ou dos dados que o usuário contou. A heurística local extrai na hora e o modelo completa em segundo plano; devolve o id, a pré-análise local (palavras-chave da vaga com as evidências que a busca local achou nos fatos do usuário) e a vaga já salva com a mesma identidade, se houver.",
    z.object({
      text: z.string().min(1).max(100_000).optional(),
      url: z.url().optional(),
      fields: Fields.optional(),
    }),
    z.object({
      postingId: IdSchema,
      status: PostingStatusSchema,
      url: z.string(),
      title: z.string(),
      preAnalysis: PreAnalysisBrief.nullable(),
      sameIdentity: z.array(Line),
    }),
  ),
  "posting.get": tool(
    "Detalhe de uma vaga salva: campos (com a origem de cada um), pré-análise local, contatos, notas e a análise mais recente (com aviso se envelheceu).",
    z.object({ id: IdSchema }),
    z.object({
      id: IdSchema,
      status: PostingStatusSchema,
      fields: z.record(z.string(), z.unknown()),
      fieldSources: z.record(z.string(), z.string()),
      preAnalysis: PreAnalysisBrief.nullable(),
      contacts: z.array(Line),
      notes: z.array(
        z.object({ id: IdSchema, author: z.string(), body: z.string(), pending: z.boolean() }),
      ),
      analysis: z
        .object({ id: IdSchema, createdAt: z.string(), stale: z.boolean(), summary: z.string() })
        .nullable(),
      url: z.string(),
    }),
  ),
  "posting.search": tool(
    "Procura vagas salvas por empresa, cliente, cargo ou role (texto livre); sem texto, as mais recentes. Uma linha por vaga.",
    z.object({
      query: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    z.object({ items: z.array(Line) }),
  ),
  "posting.update": tool(
    "Completa ou corrige campos de uma vaga salva com o que o usuário contou na conversa (ex.: cliente, faixa, data). Só os campos enviados mudam.",
    z.object({ id: IdSchema, fields: Fields }),
    z.object({ id: IdSchema, updated: z.array(z.string()) }),
  ),
  "posting.contact_add": tool(
    "Registra uma pessoa com quem o usuário falou sobre a vaga (nome, origem e, se houver, e-mail e telefone).",
    z.object({
      postingId: IdSchema,
      name: z.string().min(1),
      origin: ContactOriginSchema,
      email: z.email().optional(),
      phone: z.string().min(7).optional(),
    }),
    z.object({ id: IdSchema }),
  ),
  "posting.note_add": tool(
    "Adiciona uma nota do recrutador à vaga (o que combinaram, próximos passos, impressões).",
    z.object({ postingId: IdSchema, body: z.string().min(1).max(4000) }),
    z.object({ id: IdSchema }),
  ),
  "posting.note_update": tool(
    "Edita uma nota da vaga. Nota escrita pelo usuário não muda na hora: a edição fica pendente até ele confirmar.",
    z.object({ id: IdSchema, body: z.string().min(1).max(4000) }),
    z.object({ id: IdSchema, pending: z.boolean() }),
  ),
  "posting.open_analysis": tool(
    "Abre a conversa própria da análise desta vaga (título empresa/cliente - role) e começa a análise lá. Use quando o usuário pedir a análise numa conversa que não é a da vaga.",
    z.object({ postingId: IdSchema }),
    z.object({ sessionId: IdSchema, title: z.string(), url: z.string() }),
  ),
  "analysis.save": tool(
    "Grava a análise da vaga (consolidada de todos os perfis). Cada 'atende' precisa de evidência {kind, id} de um fato que existe; cada lacuna precisa de evidenceChecked: true depois de buscar.",
    z.object({ postingId: IdSchema, analysis: JobAnalysisSchema }),
    z.object({ analysisId: IdSchema, url: z.string() }),
  ),
  "analysis.get": tool(
    "A análise mais recente da vaga, com aviso se os dados do usuário ou a vaga mudaram depois dela.",
    z.object({ postingId: IdSchema }),
    z.object({
      analysis: JobAnalysisSchema.nullable(),
      createdAt: z.string().nullable(),
      stale: z.object({ facts: z.boolean(), posting: z.boolean() }).nullable(),
    }),
  ),
} as const;

export type PostingToolName = keyof typeof POSTING_TOOLS;

export const POSTING_TOOL_JSON_SCHEMAS = Object.fromEntries(
  (Object.keys(POSTING_TOOLS) as PostingToolName[]).map((name) => [
    name,
    {
      description: POSTING_TOOLS[name].description,
      input: toJsonSchema(POSTING_TOOLS[name].input),
      output: toJsonSchema(POSTING_TOOLS[name].output),
    },
  ]),
) as Record<PostingToolName, { description: string; input: unknown; output: unknown }>;
