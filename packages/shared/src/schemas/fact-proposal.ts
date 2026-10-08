import { z } from "zod";
import { ConfidenceSchema, IsoCountrySchema, LinkSchema, PartialDateSchema } from "./common";
import { ContractTypeSchema } from "./profile";

/** Propostas de fato extraídas de uma fonte (F01 §3 `ingestion_proposal`). Nenhuma vira fato sem revisão. */

export const IdentityDataSchema = z.object({
  displayName: z.string().min(1).optional(),
  fullName: z.string().min(1).optional(),
  email: z.email().optional(),
  phoneRaw: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  country: IsoCountrySchema.optional(),
  links: z.array(LinkSchema).optional(),
});

export const ExperienceDataSchema = z.object({
  company: z.string().min(1),
  title: z.string().min(1),
  employmentType: ContractTypeSchema.optional(),
  startDate: PartialDateSchema,
  endDate: PartialDateSchema.optional(),
  isCurrent: z.boolean(),
  location: z.string().optional(),
  summary: z.string().optional(),
  tech: z.array(z.string().min(1)),
});

export const AchievementDataSchema = z.object({
  /** Índice da experiência (na mesma extração) a que a conquista pertence. */
  experienceIndex: z.number().int().min(0),
  text: z.string().min(1),
  metric: z.string().optional(),
});

export const EducationDataSchema = z.object({
  institution: z.string().min(1),
  course: z.string().min(1),
  degree: z.string().optional(),
  startDate: PartialDateSchema.optional(),
  endDate: PartialDateSchema.optional(),
  status: z.enum(["completed", "in_progress", "incomplete"]),
});

export const SkillCategorySchema = z.enum([
  "language",
  "framework",
  "infra",
  "data",
  "tool",
  "management",
  "soft",
  "domain",
  "other",
]);

export const SkillDataSchema = z.object({
  name: z.string().min(1),
  category: SkillCategorySchema,
  level: z.number().int().min(1).max(5).optional(),
});

export const LanguageLevelSchema = z.enum(["A1", "A2", "B1", "B2", "C1", "C2", "native"]);

export const LanguageDataSchema = z.object({
  name: z.string().min(1),
  level: LanguageLevelSchema,
});

const proposal = <K extends string, D extends z.ZodTypeAny>(kind: K, data: D) =>
  z.object({ kind: z.literal(kind), confidence: ConfidenceSchema, data });

export const FactProposalSchema = z.discriminatedUnion("kind", [
  proposal("identity", IdentityDataSchema),
  proposal("experience", ExperienceDataSchema),
  proposal("achievement", AchievementDataSchema),
  proposal("education", EducationDataSchema),
  proposal("skill", SkillDataSchema),
  proposal("language", LanguageDataSchema),
  proposal("link", LinkSchema),
]);
export type FactProposal = z.infer<typeof FactProposalSchema>;
export type FactKind = FactProposal["kind"];
export const FACT_KINDS = [
  "identity",
  "experience",
  "achievement",
  "education",
  "skill",
  "language",
  "link",
] as const;
