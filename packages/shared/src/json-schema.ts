import { z } from "zod";
import {
  BuildDigestOutputSchema,
  ExtractFactsOutputSchema,
  ReadDocumentOutputSchema,
} from "./schemas/extraction-output";
import {
  AnalyzeRepoOutputSchema,
  CheckProposalsOutputSchema,
  PickFilesOutputSchema,
  SynthesizeRunOutputSchema,
} from "./schemas/ingest-output";

/**
 * JSON Schema para `outputFormat: { type: "json_schema", schema }` do Agent SDK.
 * Alvo draft-07 e sem a chave `$schema`: o CLI do Claude Code valida o schema com ajv configurado em draft-07 e sem
 * meta-schemas remotos, e rejeita `"$schema": "https://json-schema.org/draft/2020-12/schema"` com
 * `--json-schema is not a valid JSON Schema` (visto no provider real em 2026-10-08).
 */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _omitted, ...rest } = z.toJSONSchema(schema, {
    target: "draft-7",
    io: "output",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  return rest;
}

export const EXTRACTION_JSON_SCHEMAS = {
  readDocument: toJsonSchema(ReadDocumentOutputSchema),
  extractFacts: toJsonSchema(ExtractFactsOutputSchema),
  buildDigest: toJsonSchema(BuildDigestOutputSchema),
} as const;

/** Saídas das chamadas da F03 (pickFiles, analyzeRepo, synthesizeRun, checkProposals). */
export const INGEST_OUTPUT_JSON_SCHEMAS = {
  pickFiles: toJsonSchema(PickFilesOutputSchema),
  analyzeRepo: toJsonSchema(AnalyzeRepoOutputSchema),
  synthesizeRun: toJsonSchema(SynthesizeRunOutputSchema),
  checkProposals: toJsonSchema(CheckProposalsOutputSchema),
} as const;
