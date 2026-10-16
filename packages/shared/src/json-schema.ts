import { z } from "zod";
import { ChatTitleOutputSchema } from "./schemas/chat";
import { CoverLetterDraftSchema, CvDraftSchema, CvReviewOutputSchema } from "./schemas/cv";
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
import {
  PostingDuplicateOutputSchema,
  PostingExtractOutputSchema,
  PostingMergeOutputSchema,
} from "./schemas/posting";

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

export const CHAT_OUTPUT_JSON_SCHEMAS = {
  chatTitle: toJsonSchema(ChatTitleOutputSchema),
} as const;

/** Saídas das chamadas da F06 (extração, merge e duplicata da vaga). */
export const POSTING_OUTPUT_JSON_SCHEMAS = {
  postingExtract: toJsonSchema(PostingExtractOutputSchema),
  postingMerge: toJsonSchema(PostingMergeOutputSchema),
  postingDuplicate: toJsonSchema(PostingDuplicateOutputSchema),
} as const;

/** Saídas do gerador da F05 (conteúdo do CV e da carta; o código monta o resto). */
export const CV_OUTPUT_JSON_SCHEMAS = {
  cvGenerate: toJsonSchema(CvDraftSchema),
  coverLetterGenerate: toJsonSchema(CoverLetterDraftSchema),
  cvReview: toJsonSchema(CvReviewOutputSchema),
} as const;
