import { z } from "zod";
import {
  BuildDigestOutputSchema,
  ExtractFactsOutputSchema,
  ReadDocumentOutputSchema,
} from "./schemas/extraction-output";

/** JSON Schema (draft 2020-12) para `outputFormat: { type: "json_schema", schema }` do Agent SDK. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "output",
    unrepresentable: "any",
  }) as Record<string, unknown>;
}

export const EXTRACTION_JSON_SCHEMAS = {
  readDocument: toJsonSchema(ReadDocumentOutputSchema),
  extractFacts: toJsonSchema(ExtractFactsOutputSchema),
  buildDigest: toJsonSchema(BuildDigestOutputSchema),
} as const;
