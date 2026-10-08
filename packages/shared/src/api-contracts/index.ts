import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "../schemas/common";
import { FactProposalSchema } from "../schemas/fact-proposal";
import { FileDigestSchema } from "../schemas/file-digest";
import { JobSchema } from "../schemas/job";
import { ProfileBaseSchema, ProfileSchema, requireCareerFields } from "../schemas/profile";
import { UserSchema } from "../schemas/user";

/** Contratos das rotas de F01 §2.6. Fonte única para api (validação) e web (tipos). */

// GET /api/health
export const HealthResponseSchema = z.object({ ok: z.literal(true), version: z.string() });

// GET /api/provider/status
export const ProviderStatusResponseSchema = z.object({
  installed: z.boolean(),
  loggedIn: z.boolean(),
  authMethod: z.enum([
    "none",
    "claude.ai",
    "oauth_token",
    "api_key",
    "api_key_helper",
    "third_party",
  ]),
  version: z.string().nullable(),
  loginHint: z.string().nullable(),
});
export type ProviderStatusResponse = z.infer<typeof ProviderStatusResponseSchema>;

// GET /api/onboarding/state — wizard de 5 passos (F01-11: sem passo 6)
export const OnboardingStateSchema = z.object({
  step: z.number().int().min(1).max(5),
  completed: z.boolean(),
  runId: IdSchema.optional(),
  fileId: IdSchema.optional(),
});
export type OnboardingState = z.infer<typeof OnboardingStateSchema>;

// POST /api/files (multipart) → FileResponse ; POST /api/texts {text} → FileResponse
export const TextCreateRequestSchema = z.object({ text: z.string().min(200).max(50_000) });
export const FileResponseSchema = z.object({
  id: IdSchema,
  kind: z.enum(["cv", "text"]),
  originalName: z.string().nullable(),
  mime: z.string(),
  size: z.number().int().min(0),
  pages: z.number().int().min(0).nullable(),
  uploadedAt: IsoDateTimeSchema,
});
export type FileResponse = z.infer<typeof FileResponseSchema>;

// GET /api/files/:id/estimate
export const EstimateCallSchema = z.object({
  name: z.enum(["readDocument", "extractFacts", "buildDigest"]),
  model: z.string().min(1),
  tokens: z.number().int().min(0),
});
export const EstimateResponseSchema = z
  .object({ calls: z.array(EstimateCallSchema).min(1), totalTokens: z.number().int().min(0) })
  .refine((e) => e.totalTokens === e.calls.reduce((acc, c) => acc + c.tokens, 0), {
    message: "totalTokens deve ser a soma das chamadas",
    path: ["totalTokens"],
  });
export type EstimateResponse = z.infer<typeof EstimateResponseSchema>;

// POST /api/ingestions
export const IngestionOptionsSchema = z.object({
  ocr: z.boolean().default(true),
  modelRead: z.boolean().default(true),
});
export const IngestionCreateRequestSchema = z.object({
  fileId: IdSchema,
  options: IngestionOptionsSchema.default({ ocr: true, modelRead: true }),
});
export type IngestionCreateRequest = z.infer<typeof IngestionCreateRequestSchema>;

export const IngestionStatusSchema = z.enum([
  "estimating",
  "queued",
  "running",
  "review",
  "done",
  "error",
]);
export const ProposalWithIdSchema = z.object({
  id: IdSchema,
  proposal: FactProposalSchema,
  decision: z.enum(["pending", "accepted", "edited", "rejected"]),
  origin: z.enum(["text_layer", "ocr", "model_read", "consolidated"]).nullable(),
});
export const IngestionResponseSchema = z.object({
  id: IdSchema,
  fileId: IdSchema,
  status: IngestionStatusSchema,
  jobs: z.array(JobSchema),
  proposals: z.array(ProposalWithIdSchema),
  digest: FileDigestSchema.nullable(),
  error: z.string().nullable(),
});
export type IngestionResponse = z.infer<typeof IngestionResponseSchema>;

// POST /api/ingestions/:id/review
export const ReviewDecisionSchema = z
  .object({
    proposalId: IdSchema,
    decision: z.enum(["accepted", "edited", "rejected"]),
    editedData: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => d.decision !== "edited" || d.editedData !== undefined, {
    message: "editedData é obrigatório quando a decisão é 'edited'",
    path: ["editedData"],
  });
export const ReviewRequestSchema = z.object({ decisions: z.array(ReviewDecisionSchema).min(1) });
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

// GET/PUT /api/user
export const UserUpsertRequestSchema = UserSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  id: IdSchema.optional(),
});
export type UserUpsertRequest = z.infer<typeof UserUpsertRequestSchema>;

// POST /api/profiles — mesma regra de obrigatórios/needsResearch do ProfileSchema
export const ProfileCreateRequestSchema = ProfileBaseSchema.omit({
  id: true,
  userId: true,
  isActive: true,
  salaryBelowReference: true,
  cardJson: true,
  cardUpdatedAt: true,
}).superRefine(requireCareerFields);
export type ProfileCreateRequest = z.infer<typeof ProfileCreateRequestSchema>;

// GET /api/profiles/suggestion?runId=
export const ProfileSuggestionResponseSchema = z.object({
  targetTitle: z.string().nullable(),
  seniority: ProfileBaseSchema.shape.seniority.nullable(),
  area: z.string().nullable(),
  reasons: z.array(z.string()),
});

// GET /api/dashboard
export const DashboardResponseSchema = z.object({
  profile: ProfileSchema.nullable(),
  counts: z.object({
    experiences: z.number().int(),
    skills: z.number().int(),
    education: z.number().int(),
    files: z.number().int(),
  }),
  usage: z.object({
    totalTokens: z.number().int(),
    byCategory: z.record(z.string(), z.number().int()),
  }),
  pendingResearch: z.number().int(),
});

// GET /api/jobs ; GET /api/usage/summary
export const JobsListResponseSchema = z.object({ jobs: z.array(JobSchema) });
export const UsageSummaryResponseSchema = z.object({
  totalTokens: z.number().int(),
  byCategory: z.record(z.string(), z.number().int()),
  byModel: z.record(z.string(), z.number().int()),
});

// WS /ws
export const WsEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("provider.status"), status: ProviderStatusResponseSchema }),
  z.object({
    type: z.literal("job.progress"),
    jobId: IdSchema,
    stage: z.string(),
    progress: z.number().min(0).max(100),
  }),
  z.object({ type: z.literal("job.done"), jobId: IdSchema }),
  z.object({ type: z.literal("job.error"), jobId: IdSchema, error: z.string() }),
]);
export type WsEvent = z.infer<typeof WsEventSchema>;
