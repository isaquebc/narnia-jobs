import { z } from "zod";
import { toJsonSchema } from "../json-schema";
import { IdSchema } from "../schemas/common";
import { FactProposalSchema } from "../schemas/fact-proposal";
import { DigestMetaSchema, DigestSectionSchema } from "../schemas/file-digest";
import { EvidenceSchema, RunStatusSchema } from "../schemas/ingest";
import type { ToolDefinition } from "./profile";

/**
 * Tools MCP `file.*` e `ingest.*` (F03 §1, §6.2): definição aqui, handlers em `packages/core/src/ingest/tools.ts`,
 * exposição pelo servidor MCP na F04. Nunca devolvem um arquivo inteiro: texto por intervalo de no máximo 8k chars.
 */
export const FILE_TEXT_MAX_CHARS = 8_000;

const tool = <I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  description: string,
  input: I,
  output: O,
): ToolDefinition<I, O> => ({ description, input, output });

const DigestOut = z.object({
  subjectKind: z.enum(["file", "repo"]),
  subjectId: IdSchema,
  summary: z.string(),
  keyPoints: z.array(z.string()),
  sections: z.array(DigestSectionSchema),
  meta: DigestMetaSchema,
});

export const INGEST_TOOLS = {
  "file.list": tool(
    "Lista arquivos e repositórios ingeridos com uma linha cada (nome, tipo, data, se há digest).",
    z.object({ limit: z.number().int().min(1).max(100).optional() }),
    z.object({
      items: z.array(
        z.object({
          subjectKind: z.enum(["file", "repo"]),
          id: IdSchema,
          name: z.string(),
          kind: z.string(),
          date: z.string().nullable(),
          hasDigest: z.boolean(),
        }),
      ),
    }),
  ),
  "file.get_digest": tool(
    "Devolve o digest (resumo, pontos principais, índice) de um arquivo ou repositório, em vez do original.",
    z
      .object({ fileId: IdSchema.optional(), repoId: IdSchema.optional() })
      .refine((v) => Boolean(v.fileId) !== Boolean(v.repoId), {
        message: "Informe fileId ou repoId (um dos dois)",
      }),
    z.object({ digest: DigestOut.nullable() }),
  ),
  "file.get_text": tool(
    "Devolve um trecho do texto extraído de um arquivo, por intervalo de caracteres (máx. 8k por chamada).",
    z
      .object({ fileId: IdSchema, from: z.number().int().min(0), to: z.number().int().min(1) })
      .refine((v) => v.to > v.from, { message: "to deve ser maior que from", path: ["to"] })
      .refine((v) => v.to - v.from <= FILE_TEXT_MAX_CHARS, {
        message: `Intervalo máximo de ${FILE_TEXT_MAX_CHARS} caracteres`,
        path: ["to"],
      }),
    z.object({
      text: z.string(),
      from: z.number().int(),
      to: z.number().int(),
      total: z.number().int(),
    }),
  ),
  "ingest.status": tool(
    "Estado de uma execução de ingestão: status, repositórios analisados, uso e pendências de revisão.",
    z.object({ runId: IdSchema }),
    z.object({
      runId: IdSchema,
      status: RunStatusSchema,
      pendingProposals: z.number().int().min(0),
      usedTokens: z.number().int().min(0),
    }),
  ),
  "ingest.propose": tool(
    "Adiciona propostas a uma execução (vão para a revisão; nunca viram fato direto). Cada uma com trecho literal.",
    z.object({
      runId: IdSchema,
      proposals: z
        .array(z.object({ proposal: FactProposalSchema, evidence: EvidenceSchema }))
        .min(1),
    }),
    z.object({ added: z.number().int().min(0) }),
  ),
} as const;

export type IngestToolName = keyof typeof INGEST_TOOLS;

export const INGEST_TOOL_JSON_SCHEMAS = Object.fromEntries(
  (Object.keys(INGEST_TOOLS) as IngestToolName[]).map((name) => [
    name,
    {
      description: INGEST_TOOLS[name].description,
      input: toJsonSchema(INGEST_TOOLS[name].input),
      output: toJsonSchema(INGEST_TOOLS[name].output),
    },
  ]),
) as Record<IngestToolName, { description: string; input: unknown; output: unknown }>;
