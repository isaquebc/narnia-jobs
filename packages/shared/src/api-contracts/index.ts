import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "../schemas/common";
import {
  EmphasisFactKindSchema,
  EmphasisItemSchema,
  EmphasisModeSchema,
} from "../schemas/emphasis";
import { FactProposalSchema } from "../schemas/fact-proposal";
import { FileDigestSchema } from "../schemas/file-digest";
import { JobSchema } from "../schemas/job";
import { PersonaOverridesSchema, PersonaSchema } from "../schemas/persona";
import {
  ContractTypeSchema,
  LocationPrefSchema,
  ProfileBaseSchema,
  ProfileSchema,
  ResearchableFieldSchema,
  requireCareerFields,
} from "../schemas/profile";
import { ProfileCardSchema } from "../schemas/profile-card";
import { ProfileSuggestionSchema } from "../schemas/profile-suggestion";
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

// Campos internos do perfil que nenhum corpo de requisição escreve (F02 §2.9-3/4).
const PROFILE_INTERNAL_FIELDS = {
  id: true,
  userId: true,
  isActive: true,
  salaryBelowReference: true,
  cardJson: true,
  cardUpdatedAt: true,
  cardFactsVersion: true,
  archivedAt: true,
  clonedFrom: true,
} as const;

// POST /api/profiles — mesma regra de obrigatórios/needsResearch do ProfileSchema.
// `activate: true` ativa o perfil criado; sem isso só o primeiro perfil nasce ativo (F02 §2.9-3).
// `suggestionId` marca a sugestão de origem como aceita (F02 §4: aceitar abre o formulário pré-preenchido).
export const ProfileCreateRequestSchema = ProfileBaseSchema.omit(PROFILE_INTERNAL_FIELDS)
  .extend({ activate: z.boolean().optional(), suggestionId: IdSchema.optional() })
  .superRefine(requireCareerFields);
export type ProfileCreateRequest = z.infer<typeof ProfileCreateRequestSchema>;

// PATCH /api/profiles/:id — parcial; a regra de carreira é reaplicada pelo repo sobre o resultado mesclado.
// Os campos com `.default([])` perdem o padrão: num PATCH, ausente significa "não mexer", não "esvaziar".
export const ProfilePatchRequestSchema = ProfileBaseSchema.omit(PROFILE_INTERNAL_FIELDS)
  .partial()
  .extend({
    contractTypes: z.array(ContractTypeSchema).optional(),
    locations: z.array(LocationPrefSchema).optional(),
    needsResearch: z.array(ResearchableFieldSchema).optional(),
  });
export type ProfilePatchRequest = z.infer<typeof ProfilePatchRequestSchema>;

// POST /api/profiles/:id/clone — corpo = dados do novo perfil; ênfases, pitch e persona vêm do perfil de origem.
export const ProfileCloneRequestSchema = ProfileCreateRequestSchema;

// GET /api/profiles?archived=1
export const ProfilesListQuerySchema = z.object({
  archived: z
    .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false")])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});
export const ProfilesListResponseSchema = z.object({ profiles: z.array(ProfileSchema) });

// GET /api/profiles/:id/card · POST /api/profiles/:id/card/rebuild
export const ProfileCardResponseSchema = ProfileCardSchema.extend({
  profileId: IdSchema,
  valid: z.boolean(),
});
export type ProfileCardResponse = z.infer<typeof ProfileCardResponseSchema>;

// GET/PUT /api/profiles/:id/emphasis
export const EmphasisPutRequestSchema = z.object({ items: z.array(EmphasisItemSchema) });
export type EmphasisPutRequest = z.infer<typeof EmphasisPutRequestSchema>;
export const EmphasisListItemSchema = z.object({
  kind: EmphasisFactKindSchema,
  id: IdSchema,
  mode: EmphasisModeSchema,
  position: z.number().int().min(0).nullable(),
  label: z.string(),
  sublabel: z.string().nullable(),
  date: z.string().nullable(),
  relevance: z.object({ score: z.number().min(0).max(1), reasons: z.array(z.string()) }).nullable(),
});
export const EmphasisListResponseSchema = z.object({ items: z.array(EmphasisListItemSchema) });
export type EmphasisListResponse = z.infer<typeof EmphasisListResponseSchema>;

// GET/PUT /api/profiles/:id/persona
export const PersonaResponseSchema = z.object({
  persona: PersonaSchema,
  defaults: PersonaSchema,
  overrides: PersonaOverridesSchema,
});
export type PersonaResponse = z.infer<typeof PersonaResponseSchema>;
export const PersonaPutRequestSchema = PersonaOverridesSchema;

// GET /api/profiles/suggestions · POST /api/profiles/suggestions/:id/dismiss
export const SuggestionsListResponseSchema = z.object({
  suggestions: z.array(ProfileSuggestionSchema),
});
export type SuggestionsListResponse = z.infer<typeof SuggestionsListResponseSchema>;

// GET /api/profiles/analyze/estimate · POST /api/profiles/analyze
export const AnalyzeEstimateResponseSchema = z.object({
  model: z.string().min(1),
  tokens: z.number().int().min(0),
  inputChars: z.number().int().min(0),
});
export type AnalyzeEstimateResponse = z.infer<typeof AnalyzeEstimateResponseSchema>;
export const AnalyzeRequestSchema = z.object({ model: z.string().min(1).optional() });
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
export const AnalyzeResponseSchema = z.object({ job: JobSchema });

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
    projects: z.number().int(),
  }),
  usage: z.object({
    totalTokens: z.number().int(),
    byCategory: z.record(z.string(), z.number().int()),
  }),
  pendingResearch: z.number().int(),
  // F02 §2.7: cartão resumido do perfil ativo, contadores de ênfase e sugestões novas (obrigatórios desde M4, F02-19).
  card: z.object({ text: z.string(), builtAt: IsoDateTimeSchema, valid: z.boolean() }).nullable(),
  emphasis: z.object({ highlighted: z.number().int(), hidden: z.number().int() }),
  suggestions: z.number().int(),
});
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;

// GET /api/jobs ; GET /api/usage/summary
export const JobsListResponseSchema = z.object({ jobs: z.array(JobSchema) });
export const UsageSummaryResponseSchema = z.object({
  totalTokens: z.number().int(),
  byCategory: z.record(z.string(), z.number().int()),
  byModel: z.record(z.string(), z.number().int()),
});

// Eventos do F02 (§2.5 troca de perfil, §2.2 cartão). Fazem parte da união `WsEventSchema` desde M4 (F02-20).
export const ProfileSwitchedEventSchema = z.object({
  type: z.literal("profile.switched"),
  profileId: IdSchema,
});
export const ProfileCardInvalidatedEventSchema = z.object({
  type: z.literal("profile.card_invalidated"),
  profileIds: z.array(IdSchema).min(1),
});
export const ProfileWsEventSchema = z.discriminatedUnion("type", [
  ProfileSwitchedEventSchema,
  ProfileCardInvalidatedEventSchema,
]);
export type ProfileWsEvent = z.infer<typeof ProfileWsEventSchema>;

// WS /ws — jobs/provider (F01) + perfil (F02). Quem lê `jobId` discrimina por `type` antes.
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
  ProfileSwitchedEventSchema,
  ProfileCardInvalidatedEventSchema,
]);
export type WsEvent = z.infer<typeof WsEventSchema>;
/** Mantido para o barramento da api (M3); desde M4 é o próprio `WsEventSchema`. */
export const AnyWsEventSchema = WsEventSchema;
export type AnyWsEvent = WsEvent;
