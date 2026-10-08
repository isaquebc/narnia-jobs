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

/**
 * Saídas estruturadas que o modelo devolve (via `outputFormat` do SDK). São deliberadamente planas e
 * sem refinamentos complexos, para gerarem JSON Schema simples. A conversão para `FactProposal[]` é feita aqui.
 */

const withConfidence = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ confidence: ConfidenceSchema, ...shape });

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

/** Achata a saída do modelo em propostas, na ordem identity → experience(+achievements) → education → skill → language → link. */
export function extractFactsOutputToProposals(output: ExtractFactsOutput): FactProposal[] {
  const proposals: FactProposal[] = [];
  if (output.identity) {
    const { confidence, ...data } = output.identity;
    proposals.push({ kind: "identity", confidence, data });
  }
  output.experiences.forEach((exp, experienceIndex) => {
    const { confidence, achievements, ...data } = exp;
    proposals.push({ kind: "experience", confidence, data });
    for (const ach of achievements) {
      const { confidence: achConfidence, ...achData } = ach;
      proposals.push({
        kind: "achievement",
        confidence: achConfidence,
        data: { ...achData, experienceIndex },
      });
    }
  });
  for (const edu of output.education) {
    const { confidence, ...data } = edu;
    proposals.push({ kind: "education", confidence, data });
  }
  for (const skill of output.skills) {
    const { confidence, ...data } = skill;
    proposals.push({ kind: "skill", confidence, data });
  }
  for (const lang of output.languages) {
    const { confidence, ...data } = lang;
    proposals.push({ kind: "language", confidence, data });
  }
  for (const link of output.links) {
    const { confidence, ...data } = link;
    proposals.push({ kind: "link", confidence, data });
  }
  return proposals;
}
