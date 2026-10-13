import { z } from "zod";
import {
  ChatCategorySchema,
  ChatMessageSchema,
  ChatSessionSchema,
  ChatSessionStateSchema,
  ResearchSourceSchema,
  TrustedDomainSchema,
} from "../schemas/chat";
import { IdSchema, IsoDateTimeSchema } from "../schemas/common";
import {
  EmphasisFactKindSchema,
  EmphasisItemSchema,
  EmphasisModeSchema,
} from "../schemas/emphasis";
import { FactProposalSchema } from "../schemas/fact-proposal";
import { FileDigestSchema } from "../schemas/file-digest";
import {
  GithubMetricsSchema,
  RepoAnalysisSchema,
  RepoDigestSchema,
  RepoGroupSchema,
  RepoSchema,
} from "../schemas/github";
import {
  BudgetRequestSchema,
  BudgetSchema,
  BudgetUnitSchema,
  CheckStatusSchema,
  ConflictSchema,
  EvidenceSchema,
  IngestionDepthSchema,
  IngestionModeSchema,
  IngestionSourceSchema,
  PlanUsageSchema,
  ProposalMatchSchema,
  ResolutionSchema,
  RunReportSchema,
  RunStatusSchema,
} from "../schemas/ingest";
import { JobSchema } from "../schemas/job";
import { NotificationSchema } from "../schemas/notification";
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
  /** Login do volume expirou e não pôde ser renovado (2026-10-12). */
  authExpired: z.boolean().optional(),
});
export type ProviderStatusResponse = z.infer<typeof ProviderStatusResponseSchema>;

// GET /api/onboarding/state — wizard de 5 passos (F01-11: sem passo 6)
export const OnboardingStateSchema = z.object({
  step: z.number().int().min(1).max(6),
  completed: z.boolean(),
  runId: IdSchema.optional(),
  fileId: IdSchema.optional(),
});
export type OnboardingState = z.infer<typeof OnboardingStateSchema>;

// POST /api/files (multipart) → FileResponse ; POST /api/texts {text} → FileResponse
export const TextCreateRequestSchema = z.object({ text: z.string().min(200).max(50_000) });
// F03 §2.9-5: o upload informa execuções anteriores do mesmo conteúdo (mesmo sha) para o aviso "já lido".
export const PreviousRunSchema = z.object({
  runId: IdSchema,
  status: RunStatusSchema,
  createdAt: IsoDateTimeSchema,
});
export const FileResponseSchema = z.object({
  id: IdSchema,
  kind: z.enum(["cv", "text"]),
  originalName: z.string().nullable(),
  mime: z.string(),
  size: z.number().int().min(0),
  pages: z.number().int().min(0).nullable(),
  uploadedAt: IsoDateTimeSchema,
  previousRuns: z.array(PreviousRunSchema).optional(),
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

// F03: estados do F01 + confirmação, decisão no freio, pausa e cancelamento.
export const IngestionStatusSchema = RunStatusSchema;
// F03 §2.9-6: reconciliação, evidência e selo anti-alucinação; opcionais para o F01 continuar válido.
export const ProposalWithIdSchema = z.object({
  id: IdSchema,
  proposal: FactProposalSchema,
  decision: z.enum(["pending", "accepted", "edited", "rejected"]),
  origin: z.enum(["text_layer", "ocr", "model_read", "consolidated"]).nullable(),
  match: ProposalMatchSchema.optional(),
  matchTargetId: IdSchema.nullable().optional(),
  conflict: ConflictSchema.nullable().optional(),
  evidence: EvidenceSchema.nullable().optional(),
  checkStatus: CheckStatusSchema.optional(),
  suggestedProfiles: z.array(IdSchema).optional(),
});
export const FriendlyErrorSchema = z.object({
  key: z.string().min(1),
  hint: z.string().min(1),
  technical: z.string(),
});
export type FriendlyErrorDto = z.infer<typeof FriendlyErrorSchema>;

export const TimelineStepSchema = z.object({
  key: z.string().min(1),
  state: z.enum(["pending", "running", "done", "skipped", "error", "stuck"]),
  progress: z.object({ done: z.number().int(), total: z.number().int() }).optional(),
  failures: z.number().int().optional(),
  startedAt: IsoDateTimeSchema.nullable().optional(),
  finishedAt: IsoDateTimeSchema.nullable().optional(),
  durationMs: z.number().nullable().optional(),
  lastActivityAt: IsoDateTimeSchema.nullable().optional(),
  error: FriendlyErrorSchema.nullable().optional(),
});
export const TimelineSchema = z.object({
  steps: z.array(TimelineStepSchema),
  current: z.number().int().nullable(),
  total: z.number().int(),
  stuck: z.boolean(),
});
export type TimelineDto = z.infer<typeof TimelineSchema>;
export const RunProgressSchema = z.object({
  current: z.number().int().nullable(),
  total: z.number().int(),
  stepKey: z.string().nullable(),
  stuck: z.boolean(),
});

export const IngestionResponseSchema = z.object({
  id: IdSchema,
  /** Nulo para o GitHub, que não tem arquivo (F03 §2.9-2). */
  fileId: IdSchema.nullable(),
  source: IngestionSourceSchema.optional(),
  status: IngestionStatusSchema,
  jobs: z.array(JobSchema),
  proposals: z.array(ProposalWithIdSchema),
  digest: FileDigestSchema.nullable(),
  error: z.string().nullable(),
  /** Erro em linguagem simples (plano de comunicação C5): chaves do dicionário + texto técnico. */
  errorFriendly: FriendlyErrorSchema.nullable().optional(),
  /** Tarefa que falhou e será refeita pelo "Tentar de novo" (rótulo do botão, C4). */
  failedTaskType: z.string().nullable().optional(),
  /** Execução de origem (reanálise) e reanálises criadas a partir desta (plano de comunicação C4). */
  parentRunId: IdSchema.nullable().optional(),
  childRunIds: z.array(IdSchema).optional(),
  /** Etapas reais da execução (plano de comunicação C1). */
  timeline: TimelineSchema.optional(),
});
export type IngestionResponse = z.infer<typeof IngestionResponseSchema>;

// POST /api/ingestions/:id/review
export const ReviewDecisionSchema = z
  .object({
    proposalId: IdSchema,
    decision: z.enum(["accepted", "edited", "rejected"]),
    editedData: z.record(z.string(), z.unknown()).optional(),
    /** Resolução campo a campo de um conflito (F03-6); sem ela, aceitar um conflito é recusado (422). */
    resolution: ResolutionSchema.optional(),
    /** Perfis em que o fato aceito entra destacado (tags por perfil, F03 §2.8 / E2E-09). */
    profiles: z.array(IdSchema).optional(),
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
export const EmphasisPutRequestSchema = z.object({
  items: z.array(EmphasisItemSchema),
  /** Tipos substituídos pelo lote; os demais são preservados (auditoria F02-3). Ausente = todos. */
  kinds: z.array(EmphasisFactKindSchema).min(1).optional(),
});
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
export const EmphasisListResponseSchema = z.object({
  /** false quando o cartão está inválido: a relevância mostrada pode estar desatualizada (auditoria F02-9). */
  cardValid: z.boolean(),
  items: z.array(EmphasisListItemSchema),
});
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

// ---------------------------------------------------------------------------------------------------------------
// F03 · Ingestão (§2.10)

// GET /api/github/auth · PUT {source} · POST /api/github/auth/device · DELETE — o token nunca sai da api.
export const GithubAuthSourceSchema = z.enum(["host", "app"]);
export const GithubAuthStatusResponseSchema = z.object({
  source: GithubAuthSourceSchema,
  connected: z.boolean(),
  login: z.string().nullable(),
  scopes: z.array(z.string()),
  /** `gh` logado no computador do usuário e repassado pelo lançador. */
  hostAvailable: z.boolean(),
});
export type GithubAuthStatusResponse = z.infer<typeof GithubAuthStatusResponseSchema>;
export const GithubAuthPutRequestSchema = z.object({ source: GithubAuthSourceSchema });
export const GithubDeviceResponseSchema = z.object({
  code: z.string().min(4),
  verificationUri: z.url(),
  expiresAt: IsoDateTimeSchema,
});
export type GithubDeviceResponse = z.infer<typeof GithubDeviceResponseSchema>;

// POST /api/sources/github/preview
export const GithubPreviewRequestSchema = z.object({
  mode: IngestionModeSchema,
  /** Análise pública sem login: o usuário informa de quem é o perfil (F03-2). */
  login: z.string().min(1).max(39).optional(),
});
export const GithubPreviewResponseSchema = z.object({
  mode: IngestionModeSchema,
  authenticated: z.boolean(),
  rateLimited: z.boolean(),
  groups: z.array(RepoGroupSchema),
});
export type GithubPreviewResponse = z.infer<typeof GithubPreviewResponseSchema>;

// GET /api/plan/usage
export const PlanUsageResponseSchema = z.object({ usage: PlanUsageSchema.nullable() });

// POST /api/ingestions (GitHub) — CV/texto continuam com `IngestionCreateRequestSchema` (F01).
export const GithubIngestionCreateRequestSchema = z.object({
  source: z.literal("github"),
  mode: IngestionModeSchema,
  repos: z.array(z.string().min(3)).min(1),
  depth: IngestionDepthSchema,
  model: z.string().min(1),
  budget: BudgetRequestSchema.optional(),
  /** Análise pública sem login (F03-2). */
  login: z.string().min(1).max(39).optional(),
});
export type GithubIngestionCreateRequest = z.infer<typeof GithubIngestionCreateRequestSchema>;

// POST /api/ingestions/estimate
export const FileEstimateRequestSchema = z.object({
  source: z.enum(["cv", "text"]),
  fileId: IdSchema,
  model: z.string().min(1).optional(),
});
export const IngestionEstimateRequestSchema = z.union([
  GithubIngestionCreateRequestSchema,
  FileEstimateRequestSchema,
]);
export type IngestionEstimateRequest = z.infer<typeof IngestionEstimateRequestSchema>;
export const IngestionEstimateResponseSchema = z.object({
  calls: z.array(
    z.object({
      name: z.string().min(1),
      model: z.string().min(1),
      tokens: z.number().int().min(0),
    }),
  ),
  totalTokens: z.number().int().min(0),
  recommendedBudget: z.number().int().min(0),
  perRepo: z.number().int().min(0).nullable(),
  /** Conversão % → tokens ainda sem histórico (F03-3 §1). */
  approximate: z.boolean(),
  /** CV/texto abaixo de `ingest.auto_confirm_below` seguem sozinhos (F03-13). */
  autoConfirm: z.boolean(),
});
export type IngestionEstimateResponse = z.infer<typeof IngestionEstimateResponseSchema>;

// POST /api/ingestions/:id/decision — freio do orçamento (F03-3 §6)
export const IngestionDecisionRequestSchema = z.object({
  action: z.enum(["continue", "finish", "later"]),
  extraBudget: z.number().int().min(0).optional(),
});
export type IngestionDecisionRequest = z.infer<typeof IngestionDecisionRequestSchema>;

// GET /api/ingestions?status= — lista (bandeja, pendências)
export const IngestionRunSummarySchema = z.object({
  id: IdSchema,
  source: IngestionSourceSchema,
  mode: IngestionModeSchema.nullable(),
  status: RunStatusSchema,
  fileId: IdSchema.nullable(),
  model: z.string().nullable(),
  budget: BudgetSchema.nullable(),
  report: RunReportSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  /** "Etapa x de y" para bandeja, lista e pendências (plano de comunicação C1). */
  progress: RunProgressSchema.optional(),
});
export const IngestionsListResponseSchema = z.object({ runs: z.array(IngestionRunSummarySchema) });

// POST /api/repos/:id/reanalyze · GET /api/repos · GET /api/repos/:id · GET|PUT /api/repos/:id/digest
export const ReanalyzeRequestSchema = z.object({
  kind: z.enum(["incremental", "deepen", "cover"]).optional(),
});
export const ReposListResponseSchema = z.object({ repos: z.array(RepoSchema) });
export const RepoDetailResponseSchema = z.object({
  repo: RepoSchema,
  analyses: z.array(RepoAnalysisSchema),
  digest: RepoDigestSchema.nullable(),
  metrics: GithubMetricsSchema.nullable(),
});
export const RepoDigestPutRequestSchema = RepoDigestSchema.omit({
  repoId: true,
  editedByUser: true,
});
/** `PUT /api/files/:id/digest` (F03 item 6): o usuário corrige o resumo; nova ingestão não sobrescreve. */
export const FileDigestPutRequestSchema = FileDigestSchema.omit({
  fileId: true,
  editedByUser: true,
});

// GET /api/notifications?status= · POST /api/notifications/:id/read · /dismiss
export const NotificationsListQuerySchema = z.object({
  status: z.enum(["open", "resolved", "all"]).optional(),
});
export const NotificationsListResponseSchema = z.object({
  notifications: z.array(NotificationSchema),
  unresolved: z.number().int().min(0),
});
export type NotificationsListResponse = z.infer<typeof NotificationsListResponseSchema>;

// GET /api/snapshots · DELETE /api/snapshots/:id
export const SnapshotSchema = z.object({
  id: IdSchema,
  source: z.string().min(1),
  ref: z.string().min(1),
  headSha: z.string().nullable(),
  size: z.number().int().min(0),
  takenAt: IsoDateTimeSchema,
  lastUsedAt: IsoDateTimeSchema.nullable(),
});
export const SnapshotsListResponseSchema = z.object({
  snapshots: z.array(SnapshotSchema),
  totalBytes: z.number().int().min(0),
  maxBytes: z.number().int().min(0),
});

// Configurações da ingestão (F03 §3 `settings`): GET devolve tudo resolvido com padrões; PUT aceita parcial.
export const IngestSettingsSchema = z.object({
  githubAuth: GithubAuthSourceSchema,
  budgetDefaults: z.object({
    quick: z.number().int().min(0),
    balanced: z.number().int().min(0),
    deep: z.number().int().min(0),
  }),
  budgetUnit: BudgetUnitSchema,
  reviewCheckModelEnabled: z.boolean(),
  autoConfirmBelow: z.number().int().min(0),
  snapshotsMaxBytes: z.number().int().min(0),
  /** FX-4: conversão aprendida % da janela → tokens, por modelo (só leitura). */
  pctToTokens: z.record(z.string(), z.number().positive()).default({}),
});
export const IngestSettingsPutRequestSchema = IngestSettingsSchema.omit({
  pctToTokens: true,
}).partial();

// F03-fix L1 · backups (FX-2: no máximo `max` cópias no total, padrão 5, mínimo 1)
export const BackupSettingsPutRequestSchema = z.object({ max: z.number().int().min(1).max(100) });
export const BackupSettingsResponseSchema = z.object({
  max: z.number().int().min(1),
  enabled: z.boolean(),
  latest: z.object({ file: z.string(), at: z.string() }).nullable(),
  count: z.number().int().min(0),
});
export type BackupSettingsResponse = z.infer<typeof BackupSettingsResponseSchema>;

// Eventos do F03: estado da execução e notificações.
export const IngestionUpdatedEventSchema = z.object({
  type: z.literal("ingestion.updated"),
  runId: IdSchema,
  status: RunStatusSchema,
});
export const NotificationCreatedEventSchema = z.object({
  type: z.literal("notification.created"),
  notification: NotificationSchema,
});
export const NotificationUpdatedEventSchema = z.object({
  type: z.literal("notification.updated"),
  notification: NotificationSchema,
});
/** Conexão do GitHub mudou (fluxo de dispositivo concluído ou falhou, desconexão). */
export const GithubAuthUpdatedEventSchema = z.object({
  type: z.literal("github.auth_updated"),
  status: GithubAuthStatusResponseSchema,
  error: z.string().optional(),
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

// Eventos do chat (F04 §2.5, F04-13): todos no /ws existente com `sessionId`; o cliente filtra pela sessão aberta.
const ChatUsageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
});
export const ChatDeltaEventSchema = z.object({
  type: z.literal("chat.delta"),
  sessionId: IdSchema,
  text: z.string(),
});
export const ChatToolEventSchema = z.object({
  type: z.literal("chat.tool"),
  sessionId: IdSchema,
  name: z.string().min(1),
  phase: z.enum(["start", "end", "error"]),
  durationMs: z.number().int().min(0).optional(),
});
export const ChatTurnEndEventSchema = z.object({
  type: z.literal("chat.turn_end"),
  sessionId: IdSchema,
  turnIndex: z.number().int().min(0),
  usage: ChatUsageSchema,
  /** Turno cortado ("Parar", hibernação ou arquivamento no meio): a web encerra o "pensando" (auditoria B). */
  interrupted: z.boolean().optional(),
});
export const ChatErrorEventSchema = z.object({
  type: z.literal("chat.error"),
  sessionId: IdSchema,
  error: z.string(),
  /** Chave do mapa de erros amigáveis (`error.*`, C5); a web mostra a mensagem e o texto técnico recolhido. */
  errorKey: z.string().optional(),
});
export const ChatLimitEventSchema = z.object({
  type: z.literal("chat.limit"),
  sessionId: IdSchema,
  reason: z.enum(["max_turns", "max_budget"]),
});
/** Execução criada por uma tool de ingestão desta conversa (auditoria D): a web mostra o link só para ela. */
export const ChatIngestionCreatedEventSchema = z.object({
  type: z.literal("chat.ingestion_created"),
  sessionId: IdSchema,
  runId: IdSchema,
});
export const ChatSessionUpdatedEventSchema = z.object({
  type: z.literal("chat.session_updated"),
  sessionId: IdSchema,
  state: ChatSessionStateSchema,
  /** Categoria nova, quando mudou (PATCH ou `session_set_category`). */
  category: ChatCategorySchema.optional(),
});

// Rotas do chat (F04 §2.5, M3)
export const ChatSessionCreateRequestSchema = z.object({
  /** Perfil da sessão; ausente = perfil ativo. */
  profileId: IdSchema.optional(),
  category: ChatCategorySchema.default("career"),
  /** Modelo da sessão (F04-9); ausente = `chat.default_model`. */
  model: z.string().min(1).max(100).optional(),
  title: z.string().min(1).max(200).optional(),
});
export type ChatSessionCreateRequest = z.infer<typeof ChatSessionCreateRequestSchema>;
export const ChatSessionPatchRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  category: ChatCategorySchema.optional(),
  model: z.string().min(1).max(100).optional(),
  archived: z.boolean().optional(),
});
export const ChatSendRequestSchema = z.object({ text: z.string().min(1).max(50_000) });
export const ChatSessionResponseSchema = z.object({ session: ChatSessionSchema });
export const ChatSessionListResponseSchema = z.object({ sessions: z.array(ChatSessionSchema) });
export const ChatMessagesResponseSchema = z.object({ messages: z.array(ChatMessageSchema) });
/** 409 `session_limit` (F04-3): `details.live` lista as sessões vivas para a UI perguntar qual encerrar. */
export const ChatSessionLimitDetailsSchema = z.object({
  max: z.number().int().min(1),
  live: z.array(ChatSessionSchema),
});
export const ResearchListResponseSchema = z.object({ sources: z.array(ResearchSourceSchema) });

// Configurações › Chat (F04 M4): preferências (F04-3, F04-4, F04-9) e domínios confiáveis (F04-5)
export const ChatSettingsSchema = z.object({
  maxLiveSessions: z.number().int().min(1).max(20),
  hibernateAfterMin: z
    .number()
    .int()
    .min(5)
    .max(24 * 60),
  maxTurns: z.number().int().min(1).max(50),
  defaultModel: z.string().min(1).max(100),
  maxBudgetUsd: z.number().min(0).nullable(),
  requireTrustedResearch: z.boolean(),
});
export type ChatSettingsDto = z.infer<typeof ChatSettingsSchema>;
export const ChatSettingsResponseSchema = z.object({ settings: ChatSettingsSchema });
export const ChatSettingsPutRequestSchema = ChatSettingsSchema.partial();
export const TrustedDomainsResponseSchema = z.object({ domains: z.array(TrustedDomainSchema) });

// GET /api/settings/evals — Configurações › Avaliações (ponte da assinatura e Phoenix, decisão AV-2)
export const BridgeSettingsSchema = z.object({
  enabled: z.boolean(),
  defaultModel: z.string().min(1).max(100),
  concurrency: z.number().int().min(1).max(8),
});
export type BridgeSettingsDto = z.infer<typeof BridgeSettingsSchema>;
export const BridgeSettingsPutRequestSchema = BridgeSettingsSchema.partial();
export const EvalsSettingsResponseSchema = z.object({
  bridge: z.object({
    settings: BridgeSettingsSchema,
    /** Chave que o Phoenix manda em `x-api-key`. */
    key: z.string(),
    /** Endereço da ponte visto de dentro do Phoenix (rede dos containers). */
    url: z.string(),
  }),
  phoenix: z.object({
    url: z.string().nullable(),
    reachable: z.boolean(),
    providerName: z.string(),
    providerRegistered: z.boolean(),
    anthropicKeySet: z.boolean(),
  }),
  /** Prompts do repositório versionados no Phoenix (M2). */
  prompts: z.object({
    count: z.number().int().min(0),
    lastSync: z
      .object({
        at: z.string(),
        created: z.number().int().min(0),
        updated: z.number().int().min(0),
        unchanged: z.number().int().min(0),
        datasets: z.number().int().min(0),
        evaluatorsCreated: z.number().int().min(0),
        evaluatorsUpdated: z.number().int().min(0),
        error: z.string().nullable(),
      })
      .nullable(),
  }),
});
export type EvalsSettingsResponse = z.infer<typeof EvalsSettingsResponseSchema>;
export const PhoenixAnthropicKeyRequestSchema = z.object({
  apiKey: z.string().trim().min(1).max(500).nullable(),
});

// GET /api/plugin/status — Configurações › Modo plugin (F04 §4, auditoria E1)
export const PluginStatusResponseSchema = z.object({
  mcpUrl: z.string(),
  mcp: z.object({ ok: z.boolean(), tools: z.number().int().min(0) }),
  command: z.string(),
  doctorCommand: z.string(),
  lastSeenAt: z.string().nullable(),
});
export type PluginStatusResponse = z.infer<typeof PluginStatusResponseSchema>;
export const TrustedDomainCreateRequestSchema = TrustedDomainSchema.pick({
  pattern: true,
  trustTag: true,
});
export const TrustedDomainPatchRequestSchema = z.object({ enabled: z.boolean() });

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
  IngestionUpdatedEventSchema,
  NotificationCreatedEventSchema,
  NotificationUpdatedEventSchema,
  GithubAuthUpdatedEventSchema,
  ChatDeltaEventSchema,
  ChatToolEventSchema,
  ChatTurnEndEventSchema,
  ChatErrorEventSchema,
  ChatLimitEventSchema,
  ChatSessionUpdatedEventSchema,
  ChatIngestionCreatedEventSchema,
]);
export type WsEvent = z.infer<typeof WsEventSchema>;
/** Mantido para o barramento da api (M3); desde M4 é o próprio `WsEventSchema`. */
export const AnyWsEventSchema = WsEventSchema;
export type AnyWsEvent = WsEvent;
