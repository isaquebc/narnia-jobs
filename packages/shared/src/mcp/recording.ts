import { z } from "zod";
import { toJsonSchema } from "../json-schema";
import { IdSchema } from "../schemas/common";
import type { ToolDefinition } from "./profile";

/**
 * Tools da entrevista gravada (F13/M5, skill `analisar-entrevista`): listar, ler o relatório com as pessoas e a
 * transcrição por trecho, com links para o minuto exato na página da entrevista. Handlers em
 * `packages/core/src/recordings/tools.ts`. Só leitura: a análise e o relatório saem da página.
 */
const tool = <I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  description: string,
  input: I,
  output: O,
): ToolDefinition<I, O> => ({ description, input, output });

export const RECORDING_TOOLS = {
  "recording.list": tool(
    "Lista as entrevistas gravadas (uma linha por entrevista: título ou arquivo, etapa, data, estado da análise e link), da mais recente para a mais antiga. Filtra por candidatura (`jobApplicationId`) ou perfil (`profileId`); sem filtro, as do perfil ativo.",
    z.object({ jobApplicationId: IdSchema.optional(), profileId: IdSchema.optional() }),
    z.object({ items: z.array(z.object({ id: IdSchema, line: z.string(), url: z.string() })) }),
  ),
  "recording.get": tool(
    "Relatório de uma entrevista gravada: pessoas (P1, P2… com nome, papel, medições e confiabilidade), anotações e reações, e o relatório do recrutador (veredito, falas, respostas, discurso, sorriso, câmera, fichas, treinos), com o turno e o segundo de cada citação. Use `recording.transcript` para ler a conversa.",
    z.object({ id: IdSchema }),
    z.object({
      id: IdSchema,
      line: z.string(),
      url: z.string(),
      state: z.string(),
      persons: z.array(z.object({ key: z.string(), line: z.string() })),
      events: z.array(z.object({ key: z.string(), line: z.string() })),
      report: z.record(z.string(), z.unknown()).nullable(),
      limitations: z.array(z.string()),
    }),
  ),
  "recording.transcript": tool(
    "Transcrição de uma entrevista gravada, um turno por linha (`[n] mm:ss–mm:ss Pk (nome, papel): texto`). `fromTurn`/`toTurn` limitam o trecho (no máximo 80 turnos por chamada); cada turno tem o link para o segundo exato no vídeo.",
    z.object({
      id: IdSchema,
      fromTurn: z.number().int().min(0).optional(),
      toTurn: z.number().int().min(0).optional(),
    }),
    z.object({
      lines: z.array(z.object({ turn: z.number().int(), line: z.string(), url: z.string() })),
      total: z.number().int(),
    }),
  ),
} as const;

export type RecordingToolName = keyof typeof RECORDING_TOOLS;

export const RECORDING_TOOL_JSON_SCHEMAS = Object.fromEntries(
  (Object.keys(RECORDING_TOOLS) as RecordingToolName[]).map((name) => [
    name,
    {
      description: RECORDING_TOOLS[name].description,
      input: toJsonSchema(RECORDING_TOOLS[name].input),
      output: toJsonSchema(RECORDING_TOOLS[name].output),
    },
  ]),
) as Record<RecordingToolName, { description: string; input: unknown; output: unknown }>;
