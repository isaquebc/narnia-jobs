import { z } from "zod";
import { ConfidenceSchema, SenioritySchema } from "./common";
import { ProjectDataSchema, SkillDataSchema } from "./fact-proposal";
import { CoverageSchema, RepoReportSchema } from "./github";
import { EvidenceSchema } from "./ingest";

/**
 * Saídas estruturadas das chamadas da F03 (§2.5, §2.8). Planas, como as do F01, para gerarem JSON Schema simples
 * (`toJsonSchema`, sem `$schema`). Toda proposta traz evidência literal (F03-3 §8).
 */

const withEvidence = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ confidence: ConfidenceSchema, ...shape, evidence: EvidenceSchema });

/** Profunda: a chamada barata escolhe até 8 arquivos da árvore e dos candidatos (F03-3 §5). */
export const PickFilesOutputSchema = z.object({
  files: z.array(z.object({ path: z.string().min(1), reason: z.string() })).max(8),
});
export type PickFilesOutput = z.infer<typeof PickFilesOutputSchema>;

/** Uma chamada por repositório, sem tools: propostas + relatório + cobertura (F03-3 §4). */
export const AnalyzeRepoOutputSchema = z.object({
  projects: z.array(withEvidence(ProjectDataSchema.shape)),
  skills: z.array(withEvidence(SkillDataSchema.shape)),
  report: RepoReportSchema,
  coverage: CoverageSchema,
});
export type AnalyzeRepoOutput = z.infer<typeof AnalyzeRepoOutputSchema>;

/** Síntese final: lê só os relatórios; propostas transversais e o texto do relatório da execução. */
export const SynthesizeRunOutputSchema = z.object({
  skills: z.array(withEvidence(SkillDataSchema.shape)),
  seniority: z.object({ level: SenioritySchema, rationale: z.string() }).nullable(),
  report: z.object({
    summary: z.string().min(1),
    highlights: z.array(z.string()),
    gaps: z.array(z.string()),
  }),
});
export type SynthesizeRunOutput = z.infer<typeof SynthesizeRunOutputSchema>;

/** Revisor anti-alucinação (camada 2, modelo mais barato): julga se o trecho sustenta a proposta. */
export const CheckProposalsOutputSchema = z.object({
  results: z.array(
    z.object({
      proposalId: z.string().min(1),
      status: z.enum(["supported", "partial", "unsupported"]),
      note: z.string().optional(),
    }),
  ),
});
export type CheckProposalsOutput = z.infer<typeof CheckProposalsOutputSchema>;
