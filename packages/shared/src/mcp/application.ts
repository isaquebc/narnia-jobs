import { z } from "zod";
import { toJsonSchema } from "../json-schema";
import { IdSchema } from "../schemas/common";
import type { ToolDefinition } from "./profile";

/**
 * Tools do formulário de candidatura (F12/M5): o recrutador lê as perguntas e as respostas atuais e grava uma resposta
 * combinada com a pessoa na conversa do formulário. Handlers em `packages/core/src/applications/tools.ts`.
 */
const tool = <I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  description: string,
  input: I,
  output: O,
): ToolDefinition<I, O> => ({ description, input, output });

const Question = z.object({
  questionId: z.string(),
  question: z.string(),
  kind: z.string(),
  required: z.boolean(),
  options: z.array(z.string()),
  maxChars: z.number().nullable(),
  /** Resposta atual (a versão mais nova) e de onde veio: modelo, roleplay, chat ou editada pela pessoa. */
  answer: z.string().nullable(),
  source: z.string().nullable(),
  gap: z.string().nullable(),
  /** Consentimento, autodeclaração e anexo ficam com a pessoa, direto no formulário. */
  editable: z.boolean(),
});

export const APPLICATION_TOOLS = {
  "application.get": tool(
    "Lê o formulário de candidatura: endereço, vaga ligada e cada pergunta com tipo, opções, limite de caracteres e a resposta atual (com a origem: modelo, roleplay, chat ou editada pela pessoa).",
    z.object({ applicationId: IdSchema }),
    z.object({
      applicationId: IdSchema,
      url: z.string(),
      title: z.string().nullable(),
      postingId: IdSchema.nullable(),
      questions: z.array(Question),
    }),
  ),
  "application.answer_save": tool(
    "Grava a resposta de uma pergunta do formulário, combinada com a pessoa nesta conversa: vira a versão nova na janela (a anterior fica no histórico). Escolha só com o texto exato de uma opção (várias separadas por '; '); texto dentro do limite de caracteres; consentimento, autodeclaração e anexo não são gravados.",
    z.object({
      applicationId: IdSchema,
      questionId: z.string().min(1),
      answer: z.string().trim().min(1).max(10_000),
    }),
    z.object({ questionId: z.string(), version: z.number().int().positive() }),
  ),
} as const;

export type ApplicationToolName = keyof typeof APPLICATION_TOOLS;

export const APPLICATION_TOOL_JSON_SCHEMAS = Object.fromEntries(
  (Object.keys(APPLICATION_TOOLS) as ApplicationToolName[]).map((name) => [
    name,
    {
      description: APPLICATION_TOOLS[name].description,
      input: toJsonSchema(APPLICATION_TOOLS[name].input),
      output: toJsonSchema(APPLICATION_TOOLS[name].output),
    },
  ]),
) as Record<ApplicationToolName, { description: string; input: unknown; output: unknown }>;
