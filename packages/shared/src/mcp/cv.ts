import { z } from "zod";
import { toJsonSchema } from "../json-schema";
import { IdSchema } from "../schemas/common";
import {
  CoverLetterDraftSchema,
  CoverLetterFormatSchema,
  CvDraftSchema,
  CvReviewSchema,
  DocumentKindSchema,
} from "../schemas/cv";
import type { ToolDefinition } from "./profile";

/**
 * Tools do CV e da carta (F05 §2.8): definição aqui; handlers em `packages/core/src/documents/tools.ts`. A geração é a
 * mesma do botão (tarefa `cv.generate`); pelo chat o recrutador também altera o documento pronto (`cv.edit`), sem
 * regerar tudo. `ui.suggest_action` vira um botão validado na mensagem (no terminal, um link).
 */
const tool = <I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  description: string,
  input: I,
  output: O,
): ToolDefinition<I, O> => ({ description, input, output });

const DocumentLine = z.object({
  documentId: IdSchema,
  kind: DocumentKindSchema,
  profileId: IdSchema,
  postingId: IdSchema.nullable(),
  version: z.number().int(),
  status: z.string(),
  url: z.string(),
});

export const CV_TOOLS = {
  "cv.generate": tool(
    "Gera (ou atualiza, com versão nova) o CV de um perfil, o CV para uma vaga ou a carta de apresentação da vaga, em segundo plano: o mesmo caminho do botão. `instructions` leva o pedido do usuário (ex.: 'dê mais peso à liderança'). Se a vaga for num idioma que o currículo não mostra fluente, devolve status needs_language_confirmation: pergunte ao usuário se continua e, se sim, chame de novo com acceptLanguage: true. Responda com o link; nunca escreva o CV no chat.",
    z.object({
      kind: DocumentKindSchema,
      profileId: IdSchema,
      postingId: IdSchema.nullable().optional(),
      instructions: z.string().max(2000).nullable().optional(),
      acceptLanguage: z.boolean().optional(),
      withCoverLetter: z.boolean().optional(),
      format: CoverLetterFormatSchema.optional(),
    }),
    z.object({
      status: z.enum(["queued", "needs_language_confirmation"]),
      documents: z.array(DocumentLine),
      language: z.string().nullable(),
      message: z.string(),
    }),
  ),
  "cv.get": tool(
    "O CV ou a carta: estado, versão atual, resultado da revisão (aprovado ou não, nota ATS, apontamentos), validade e o conteúdo para alterar com cv.edit. Pelo id do documento, ou pelo tipo, perfil e vaga.",
    z.object({
      documentId: IdSchema.optional(),
      kind: DocumentKindSchema.optional(),
      profileId: IdSchema.optional(),
      postingId: IdSchema.nullable().optional(),
    }),
    z.object({
      document: DocumentLine.nullable(),
      review: CvReviewSchema.nullable(),
      stale: z
        .object({ facts: z.boolean(), profile: z.boolean(), posting: z.boolean() })
        .nullable(),
      /** Conteúdo atual no formato do cv.edit (`cv` ou `letter`). */
      draft: z
        .object({ cv: CvDraftSchema.optional(), letter: CoverLetterDraftSchema.optional() })
        .nullable(),
    }),
  ),
  "cv.edit": tool(
    "Altera o CV ou a carta prontos a pedido do usuário, sem regerar tudo: mande o conteúdo inteiro (o de cv.get com as mudanças) em `cv` ou `letter` e a versão em que se baseou. Cria uma versão nova, monta o PDF e passa pela revisão. Mesma regra do gerador: só fatos existentes, com a origem (factIds) em cada bullet.",
    z.object({
      documentId: IdSchema,
      baseVersion: z.number().int().min(1),
      cv: CvDraftSchema.optional(),
      letter: CoverLetterDraftSchema.optional(),
    }),
    DocumentLine,
  ),
  "cv.list": tool(
    "CVs e cartas de um perfil ou de uma vaga, com o estado da versão atual e o link.",
    z.object({ profileId: IdSchema.optional(), postingId: IdSchema.optional() }),
    z.object({ documents: z.array(DocumentLine) }),
  ),
  "ui.suggest_action": tool(
    "Sugere um botão na mensagem do chat (no terminal, um link): gerar CV ou carta (document.generate, com kind, profileId e postingId opcional) ou abrir um documento (document.open, com documentId). O servidor confere se a ação e os ids existem; use quando a próxima ação natural do usuário for essa.",
    z.object({
      action: z.enum(["document.generate", "document.open"]),
      label: z.string().min(1).max(60),
      params: z.object({
        kind: DocumentKindSchema.optional(),
        profileId: IdSchema.optional(),
        postingId: IdSchema.nullable().optional(),
        documentId: IdSchema.optional(),
      }),
    }),
    z.object({
      action: z.string(),
      label: z.string(),
      params: z.record(z.string(), z.unknown()),
      url: z.string(),
    }),
  ),
} as const;

export type CvToolName = keyof typeof CV_TOOLS;

export const CV_TOOL_JSON_SCHEMAS = Object.fromEntries(
  (Object.keys(CV_TOOLS) as CvToolName[]).map((name) => [
    name,
    {
      description: CV_TOOLS[name].description,
      input: toJsonSchema(CV_TOOLS[name].input),
      output: toJsonSchema(CV_TOOLS[name].output),
    },
  ]),
) as Record<CvToolName, { description: string; input: unknown; output: unknown }>;
