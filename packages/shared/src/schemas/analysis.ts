import { z } from "zod";
import { IdSchema } from "./common";
import { EvidenceKindSchema, PostingRiskSchema } from "./posting";

/**
 * Análise de uma vaga (F06 §2.5), montada pelo recrutador geral com o especializado de cada perfil e gravada por
 * `analysis.save`. Honestidade pelo schema: "atende" exige evidência ({tipo, id} de um fato que existe); "lacuna" exige
 * `evidenceChecked: true` (o agente buscou e não achou). Os metadados (modelo, uso, versões) ficam na linha do banco.
 */
export const EvidenceIdSchema = z.object({ kind: EvidenceKindSchema, id: IdSchema });
export type EvidenceId = z.infer<typeof EvidenceIdSchema>;

const Text = z.string().trim().min(1);

export const JobAnalysisSchema = z.object({
  /** Leitura honesta em 2–4 frases: o veredito e o porquê. */
  summary: Text,
  /** Aderência de cada perfil analisado (F06: o recrutador compara os perfis). */
  profiles: z
    .array(
      z.object({
        profileId: IdSchema,
        fit: z.number().int().min(0).max(100),
        rationale: Text,
        confidence: z.enum(["low", "medium", "high"]),
      }),
    )
    .min(1),
  recommendedProfileId: IdSchema,
  recommendationRationale: Text,
  matches: z.array(
    z.object({
      requirement: Text,
      evidence: z.array(EvidenceIdSchema).min(1),
      strength: z.enum(["strong", "partial"]),
    }),
  ),
  gaps: z.array(
    z.object({
      requirement: Text,
      severity: z.enum(["blocking", "important", "minor"]),
      /** O agente buscou nos fatos (`fact_search`) e não achou evidência. */
      evidenceChecked: z.literal(true),
      suggestion: Text,
    }),
  ),
  risks: z.array(PostingRiskSchema),
  atsKeywordsMissing: z.array(z.object({ term: Text, where: Text })),
  likelyQuestions: z.array(
    z.object({ question: Text, why: Text, evidence: z.array(EvidenceIdSchema) }),
  ),
  /** O que estudar para fechar as lacunas (pedido do dono, F06). */
  studyRecommendations: z.array(z.object({ topic: Text, why: Text })),
  /** O que melhorar no currículo para esta vaga (entrada da F05). */
  cvImprovements: z.array(z.object({ suggestion: Text, why: Text })),
  seniority: z.object({
    asked: z.string().nullable(),
    profile: z.string().nullable(),
    note: z.string(),
  }),
});
export type JobAnalysis = z.infer<typeof JobAnalysisSchema>;

/** Análise gravada (linha `job_analysis`) com a validade (F06-10): envelheceu se fatos ou vaga mudaram depois. */
export const JobAnalysisRecordSchema = z.object({
  id: IdSchema,
  postingId: IdSchema,
  analysis: JobAnalysisSchema,
  recommendedProfileId: IdSchema.nullable(),
  factsVersion: z.number().int(),
  postingUpdatedAt: z.string(),
  models: z.array(z.string()),
  chatSessionId: IdSchema.nullable(),
  createdAt: z.string(),
  stale: z.object({ facts: z.boolean(), posting: z.boolean() }),
});
export type JobAnalysisRecordView = z.infer<typeof JobAnalysisRecordSchema>;
