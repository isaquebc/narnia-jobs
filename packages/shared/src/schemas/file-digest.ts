import { z } from "zod";
import { IdSchema, PartialDateSchema } from "./common";

export const DigestSectionSchema = z
  .object({
    title: z.string().min(1),
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  })
  .refine((s) => s.end >= s.start, { message: "Seção com fim antes do início", path: ["end"] });

export const DigestMetaSchema = z.object({
  pages: z.number().int().min(0).optional(),
  language: z.string().optional(),
  docDate: PartialDateSchema.optional(),
});

/** Registro de contexto de um arquivo (F01 §3 `file_digest`): o agente lê isto em vez de reabrir o arquivo. */
export const FileDigestSchema = z.object({
  fileId: IdSchema,
  summary: z.string().min(1),
  keyPoints: z.array(z.string().min(1)),
  sections: z.array(DigestSectionSchema),
  meta: DigestMetaSchema,
  editedByUser: z.boolean(),
});
export type FileDigest = z.infer<typeof FileDigestSchema>;
