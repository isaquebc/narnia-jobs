import { z } from "zod";
import { ConfidenceSchema, LinkSchema } from "./common";
import {
  AchievementDataSchema,
  EducationDataSchema,
  ExperienceDataSchema,
  type FactProposal,
  IdentityDataSchema,
  LanguageDataSchema,
  SkillDataSchema,
} from "./fact-proposal";
import { DigestMetaSchema, DigestSectionSchema, FileDigestSchema } from "./file-digest";
import { type Evidence, EvidenceSchema } from "./ingest";

/**
 * Saídas estruturadas que o modelo devolve (via `outputFormat` do SDK). São deliberadamente planas e
 * sem refinamentos complexos, para gerarem JSON Schema simples. A conversão para `FactProposal[]` é feita aqui.
 */

/** Evidência literal por proposta (F03-12): opcional no schema para o F01 continuar válido; o prompt pede sempre. */
const withConfidence = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ confidence: ConfidenceSchema, ...shape, evidence: EvidenceSchema.optional() });

export const ReadDocumentOutputSchema = z.object({
  text: z.string().min(1),
  sections: z.array(DigestSectionSchema),
});
export type ReadDocumentOutput = z.infer<typeof ReadDocumentOutputSchema>;

const AchievementOutputSchema = withConfidence(
  AchievementDataSchema.omit({ experienceIndex: true }).shape,
);

export const ExtractFactsOutputSchema = z.object({
  identity: withConfidence(IdentityDataSchema.shape).optional(),
  experiences: z.array(
    withConfidence({
      ...ExperienceDataSchema.shape,
      achievements: z.array(AchievementOutputSchema).default([]),
    }),
  ),
  education: z.array(withConfidence(EducationDataSchema.shape)),
  skills: z.array(withConfidence(SkillDataSchema.shape)),
  languages: z.array(withConfidence(LanguageDataSchema.shape)),
  links: z.array(withConfidence(LinkSchema.shape)),
});
export type ExtractFactsOutput = z.infer<typeof ExtractFactsOutputSchema>;

export const BuildDigestOutputSchema = FileDigestSchema.omit({
  fileId: true,
  editedByUser: true,
}).extend({
  meta: DigestMetaSchema,
});
export type BuildDigestOutput = z.infer<typeof BuildDigestOutputSchema>;

/**
 * Achata a saída do modelo em propostas + evidência paralela (F03-12), na ordem identity → experience(+achievements)
 * → education → skill → language → link. A evidência sai do `data` da proposta.
 */
export function extractFactsOutputWithEvidence(output: ExtractFactsOutput): {
  proposals: FactProposal[];
  evidence: Array<Evidence | null>;
} {
  const proposals: FactProposal[] = [];
  const evidence: Array<Evidence | null> = [];
  const push = (p: FactProposal, e: Evidence | undefined) => {
    proposals.push(p);
    evidence.push(e ?? null);
  };
  if (output.identity) {
    const { confidence, evidence: e, ...data } = output.identity;
    push({ kind: "identity", confidence, data }, e);
  }
  output.experiences.forEach((exp, experienceIndex) => {
    const { confidence, achievements, evidence: e, ...data } = exp;
    push({ kind: "experience", confidence, data }, e);
    for (const ach of achievements) {
      const { confidence: achConfidence, evidence: ae, ...achData } = ach;
      push(
        { kind: "achievement", confidence: achConfidence, data: { ...achData, experienceIndex } },
        ae,
      );
    }
  });
  for (const edu of output.education) {
    const { confidence, evidence: e, ...data } = edu;
    push({ kind: "education", confidence, data }, e);
  }
  for (const skill of output.skills) {
    const { confidence, evidence: e, ...data } = skill;
    push({ kind: "skill", confidence, data }, e);
  }
  for (const lang of output.languages) {
    const { confidence, evidence: e, ...data } = lang;
    push({ kind: "language", confidence, data }, e);
  }
  for (const link of output.links) {
    const { confidence, evidence: e, ...data } = link;
    push({ kind: "link", confidence, data }, e);
  }
  return { proposals, evidence };
}

/** Só as propostas (F01), sem a evidência. */
export function extractFactsOutputToProposals(output: ExtractFactsOutput): FactProposal[] {
  return extractFactsOutputWithEvidence(output).proposals;
}
