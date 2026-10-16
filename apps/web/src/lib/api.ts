import type {
  AnalyzeEstimateResponse,
  AnalyzeRequest,
  BackupSettingsResponse,
  BridgeSettingsDto,
  Budget,
  ChatCategory,
  ChatMessage,
  ChatSession,
  ChatSettingsDto,
  CoverLetterContent,
  CoverLetterDraft,
  CoverLetterFormat,
  CvContent,
  CvDraft,
  CvLinkKind,
  CvLocale,
  CvReview,
  DashboardResponseSchema,
  DocumentKind,
  EmphasisListResponse,
  EmphasisPutRequest,
  EstimateResponse,
  EvalsSettingsResponse,
  EvidenceFile,
  FileDigest,
  FileResponse,
  GithubAuthSourceSchema,
  GithubAuthStatusResponse,
  GithubDeviceResponse,
  GithubIngestionCreateRequest,
  GithubMetrics,
  GithubPreviewResponse,
  IngestionCreateRequest,
  IngestionDecisionRequest,
  IngestionEstimateRequest,
  IngestionEstimateResponse,
  IngestionMode,
  IngestionResponse,
  IngestSettingsSchema,
  Job,
  JobAnalysis,
  NotificationsListResponse,
  OnboardingState,
  Paper,
  PersonaOverrides,
  PersonaResponse,
  PlanUsage,
  PluginStatusResponse,
  Posting,
  PostingContact,
  PostingContactInput,
  PostingModels,
  PostingNote,
  PostingPatch,
  Profile,
  ProfileCardResponse,
  ProfileCreateRequest,
  ProfilePatchRequest,
  ProfileSuggestionResponseSchema,
  ProviderStatusResponse,
  Repo,
  RepoAnalysis,
  RepoDigest,
  ResearchSource,
  ReviewRequest,
  RunOrigin,
  RunReport,
  RunStatus,
  SalaryReference,
  SnapshotsListResponseSchema,
  SuggestionsListResponse,
  TrustedDomain,
  TrustTag,
  User,
  UserUpsertRequest,
} from "@narnia-jobs/shared";
import type { z } from "zod";

/** A API devolve também `createdAt`/`updatedAt` do registro do perfil (campos fora do schema do shared). */
export type ProfileRecord = Profile & { createdAt?: string; updatedAt?: string };
export type Dashboard = Omit<z.infer<typeof DashboardResponseSchema>, "profile"> & {
  profile: ProfileRecord | null;
};
export type ProfileSuggestion = z.infer<typeof ProfileSuggestionResponseSchema> & {
  altTitles?: string[];
  yearsOfExperience?: number;
};
export type IngestionDetail = IngestionResponse & {
  options?: { ocr: boolean; modelRead: boolean };
  /** Estimativa por chamada (texto/arquivo); a conversa e a tela mostram o total antes de confirmar (auditoria E1). */
  estimate?: { documentTokens: number; factsTokens: number; digestTokens: number } | null;
  proposals: Array<IngestionResponse["proposals"][number] & { editedData?: unknown }>;
  readings?: Array<{ id: string; kind: string; quality: number | null }>;
  // F03: execução do GitHub (orçamento, relatório, repositórios e análises)
  mode?: IngestionMode | null;
  model?: string | null;
  depth?: string | null;
  budget?: Budget | null;
  report?: RunReport | null;
  repos?: string[];
  analyses?: RepoAnalysis[];
  parentRunId?: string | null;
  createdAt?: string;
};
export type GithubAuthSource = z.infer<typeof GithubAuthSourceSchema>;
export type IngestSettings = z.infer<typeof IngestSettingsSchema>;
export type SnapshotsList = z.infer<typeof SnapshotsListResponseSchema>;
export interface RunSummary {
  /** "Etapa x de y" (plano de comunicação C1). */
  progress?: { current: number | null; total: number; stepKey: string | null; stuck: boolean };
  /** De onde veio: arquivo, começo do texto e a conversa que abriu (2026-10-14). */
  origin?: RunOrigin;
  id: string;
  source: "cv" | "text" | "github";
  mode: IngestionMode | null;
  status: RunStatus;
  fileId: string | null;
  model: string | null;
  budget: Budget | null;
  report: RunReport | null;
  createdAt: string;
}
export interface RepoDetail {
  repo: Repo;
  analyses: RepoAnalysis[];
  digest: RepoDigest | null;
  metrics: GithubMetrics | null;
}
export type RepoDigestInput = Omit<RepoDigest, "repoId" | "editedByUser">;
export type EstimateDetail = EstimateResponse & { labels?: Record<string, string> };

export class ApiError extends Error {
  override readonly name = "ApiError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface ApiClientOptions {
  fetch?: typeof fetch;
  getToken?: () => string | null;
  baseUrl?: string;
}

async function parseError(res: Response): Promise<ApiError> {
  let code = `http_${res.status}`;
  let message = res.statusText || `HTTP ${res.status}`;
  let details: unknown;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      details = body.error.details;
    }
  } catch {
    // corpo não-JSON: mantém o status
  }
  if (res.status === 401) code = "unauthorized";
  return new ApiError(res.status, code, message, details);
}

export function createApiClient(opts: ApiClientOptions = {}) {
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const base = opts.baseUrl ?? "";

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    const token = opts.getToken?.();
    if (token) headers.set("authorization", `Bearer ${token}`);
    if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { ...init, headers, credentials: "same-origin" });
    } catch (e) {
      throw new ApiError(0, "network", e instanceof Error ? e.message : "Falha de rede");
    }
    if (!res.ok) throw await parseError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

  return {
    // F04 · chat com o recrutador
    listChatSessions: (profileId?: string | null, archived = false) =>
      request<{ sessions: ChatSession[] }>(
        `/api/sessions?${new URLSearchParams({
          ...(profileId ? { profile: profileId } : {}),
          ...(archived ? { archived: "1" } : {}),
        }).toString()}`,
      ),
    getChatSession: (id: string) =>
      request<{ session: ChatSession }>(`/api/sessions/${encodeURIComponent(id)}`),
    createChatSession: (req: {
      profileId?: string;
      category?: ChatCategory;
      model?: string;
      title?: string;
    }) => request<{ session: ChatSession }>("/api/sessions", json(req)),
    patchChatSession: (
      id: string,
      patch: { title?: string; category?: ChatCategory; model?: string; archived?: boolean },
    ) =>
      request<{ session: ChatSession }>(`/api/sessions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    deleteChatSession: (id: string) =>
      request<void>(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
    listChatMessages: (
      id: string,
      opts: { before?: string; since?: string; limit?: number } = {},
    ) =>
      request<{ messages: ChatMessage[] }>(
        `/api/sessions/${encodeURIComponent(id)}/messages?${new URLSearchParams(
          Object.entries(opts)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        ).toString()}`,
      ),
    markChatRead: (id: string, messageId: string) =>
      request<{ session: ChatSession }>(
        `/api/sessions/${encodeURIComponent(id)}/read`,
        json({ messageId }),
      ),
    sendChatMessage: (id: string, text: string) =>
      request<{ turnIndex: number }>(
        `/api/sessions/${encodeURIComponent(id)}/messages`,
        json({ text }),
      ),
    interruptChat: (id: string) =>
      request<unknown>(`/api/sessions/${encodeURIComponent(id)}/interrupt`, json({})),
    hibernateChat: (id: string) =>
      request<{ session: ChatSession }>(
        `/api/sessions/${encodeURIComponent(id)}/hibernate`,
        json({}),
      ),
    wakeChat: (id: string) =>
      request<{ session: ChatSession }>(`/api/sessions/${encodeURIComponent(id)}/wake`, json({})),
    clarifyIngestion: (runId: string) =>
      request<{ session: ChatSession }>(
        `/api/ingestions/${encodeURIComponent(runId)}/clarify`,
        json({}),
      ),
    listResearch: (profileId?: string | null) =>
      request<{ sources: ResearchSource[] }>(
        `/api/research${profileId ? `?profile=${encodeURIComponent(profileId)}` : ""}`,
      ),
    getActiveProfileCard: () =>
      request<{ profileId: string; cardHash: string; text: string }>(
        "/api/profiles/active/persona-card",
      ),
    getChatSettings: () => request<{ settings: ChatSettingsDto }>("/api/settings/chat"),
    getPluginStatus: () => request<PluginStatusResponse>("/api/plugin/status"),
    // Configurações › Avaliações (ponte da assinatura e Phoenix, AV-2)
    getEvalsSettings: () => request<EvalsSettingsResponse>("/api/settings/evals"),
    putBridgeSettings: (patch: Partial<BridgeSettingsDto>) =>
      request<EvalsSettingsResponse>("/api/settings/evals/bridge", {
        method: "PUT",
        body: JSON.stringify(patch),
      }),
    rotateBridgeKey: () =>
      request<EvalsSettingsResponse>("/api/settings/evals/bridge/rotate-key", { method: "POST" }),
    registerPhoenixBridge: () =>
      request<EvalsSettingsResponse>("/api/settings/evals/phoenix/register", { method: "POST" }),
    syncPhoenixPrompts: () =>
      request<EvalsSettingsResponse>("/api/settings/evals/prompts/sync", { method: "POST" }),
    putPhoenixAnthropicKey: (apiKey: string | null) =>
      request<EvalsSettingsResponse>("/api/settings/evals/phoenix/anthropic-key", {
        method: "PUT",
        body: JSON.stringify({ apiKey }),
      }),
    putChatSettings: (patch: Partial<ChatSettingsDto>) =>
      request<{ settings: ChatSettingsDto }>("/api/settings/chat", {
        method: "PUT",
        body: JSON.stringify(patch),
      }),
    listTrustedDomains: () =>
      request<{ domains: TrustedDomain[] }>("/api/settings/trusted-domains"),
    addTrustedDomain: (d: { pattern: string; trustTag: TrustTag }) =>
      request<{ domain: TrustedDomain }>("/api/settings/trusted-domains", json(d)),
    patchTrustedDomain: (id: string, enabled: boolean) =>
      request<{ domains: TrustedDomain[] }>(
        `/api/settings/trusted-domains/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        },
      ),
    deleteTrustedDomain: (id: string) =>
      request<void>(`/api/settings/trusted-domains/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    restoreTrustedDomains: () =>
      request<{ domains: TrustedDomain[] }>("/api/settings/trusted-domains/restore", json({})),
    getHealth: () => request<{ ok: true; version: string }>("/api/health"),
    getProviderStatus: () => request<ProviderStatusResponse>("/api/provider/status"),
    setMockMode: (mode: Record<string, unknown>) =>
      request<{ status: ProviderStatusResponse }>("/api/_test/mock", json(mode)),
    getOnboardingState: () => request<OnboardingState>("/api/onboarding/state"),
    putOnboardingState: (state: OnboardingState) =>
      request<OnboardingState>("/api/onboarding/state", {
        method: "PUT",
        body: JSON.stringify(state),
      }),
    uploadFile: (file: File) => {
      const form = new FormData();
      form.append("file", file, file.name);
      return request<FileResponse>("/api/files", { method: "POST", body: form });
    },
    createText: (text: string) => request<FileResponse>("/api/texts", json({ text })),
    getFile: (id: string) => request<FileResponse>(`/api/files/${encodeURIComponent(id)}`),
    getEstimate: (id: string, options: { ocr: boolean; modelRead: boolean }) =>
      request<EstimateDetail>(
        `/api/files/${encodeURIComponent(id)}/estimate?ocr=${options.ocr}&modelRead=${options.modelRead}`,
      ),
    createIngestion: (body: IngestionCreateRequest) =>
      request<IngestionDetail>("/api/ingestions", json(body)),
    getIngestion: (id: string) =>
      request<IngestionDetail>(`/api/ingestions/${encodeURIComponent(id)}`),
    reviewIngestion: (id: string, body: ReviewRequest) =>
      request<{ pending: number; runStatus: string }>(
        `/api/ingestions/${encodeURIComponent(id)}/review`,
        json(body),
      ),
    listJobs: () => request<{ jobs: Job[] }>("/api/jobs"),
    getWorkerSettings: () => request<WorkerSettings>("/api/settings/workers"),
    putWorkerSettings: (patch: Partial<WorkerSettings["concurrency"]>) =>
      request<WorkerSettings>("/api/settings/workers", {
        method: "PUT",
        body: JSON.stringify(patch),
      }),
    cancelJob: (id: string) => request<Job>(`/api/jobs/${encodeURIComponent(id)}/cancel`, json({})),
    retryJob: (id: string) => request<Job>(`/api/jobs/${encodeURIComponent(id)}/retry`, json({})),
    getUsageSummary: () =>
      request<{
        totalTokens: number;
        byCategory: Record<string, number>;
        byModel: Record<string, number>;
      }>("/api/usage/summary"),
    getUser: () => request<{ user: User | null }>("/api/user"),
    addUserLink: (link: { label: string; url: string }) =>
      request<{ user: User }>("/api/user/links", json(link)),
    putUser: (body: UserUpsertRequest) =>
      request<{ user: User }>("/api/user", { method: "PUT", body: JSON.stringify(body) }),
    listProfiles: (opts?: { archived?: boolean }) =>
      request<{ profiles: ProfileRecord[] }>(`/api/profiles${opts?.archived ? "?archived=1" : ""}`),
    createProfile: (body: ProfileCreateRequest) =>
      request<ProfileRecord>("/api/profiles", json(body)),
    // F02 §2.7 — perfis, cartão, ênfases, persona, sugestões e análise
    getProfile: (id: string) => request<ProfileRecord>(`/api/profiles/${encodeURIComponent(id)}`),
    patchProfile: (id: string, body: ProfilePatchRequest) =>
      request<ProfileRecord>(`/api/profiles/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    activateProfile: (id: string) =>
      request<ProfileRecord>(`/api/profiles/${encodeURIComponent(id)}/activate`, {
        method: "PUT",
        body: JSON.stringify({}),
      }),
    archiveProfile: (id: string) =>
      request<ProfileRecord>(`/api/profiles/${encodeURIComponent(id)}/archive`, json({})),
    unarchiveProfile: (id: string) =>
      request<ProfileRecord>(`/api/profiles/${encodeURIComponent(id)}/unarchive`, json({})),
    cloneProfile: (sourceId: string, body: ProfileCreateRequest) =>
      request<ProfileRecord>(`/api/profiles/${encodeURIComponent(sourceId)}/clone`, json(body)),
    getProfileCard: (id: string) =>
      request<ProfileCardResponse>(`/api/profiles/${encodeURIComponent(id)}/card`),
    rebuildProfileCard: (id: string) =>
      request<ProfileCardResponse>(
        `/api/profiles/${encodeURIComponent(id)}/card/rebuild`,
        json({}),
      ),
    getEmphasis: (id: string) =>
      request<EmphasisListResponse>(`/api/profiles/${encodeURIComponent(id)}/emphasis`),
    putEmphasis: (id: string, body: EmphasisPutRequest) =>
      request<{ updated: number }>(`/api/profiles/${encodeURIComponent(id)}/emphasis`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    getPersona: (id: string) =>
      request<PersonaResponse>(`/api/profiles/${encodeURIComponent(id)}/persona`),
    putPersona: (id: string, overrides: PersonaOverrides) =>
      request<PersonaResponse>(`/api/profiles/${encodeURIComponent(id)}/persona`, {
        method: "PUT",
        body: JSON.stringify(overrides),
      }),
    /** `seen`: a página de perfis foi aberta; a api resolve a notificação "análise concluída" (F03-10). */
    listSuggestions: (opts: { seen?: boolean } = {}) =>
      request<SuggestionsListResponse>(`/api/profiles/suggestions${opts.seen ? "?seen=1" : ""}`),
    dismissSuggestion: (id: string) =>
      request<{ ok: true }>(
        `/api/profiles/suggestions/${encodeURIComponent(id)}/dismiss`,
        json({}),
      ),
    getAnalyzeEstimate: () => request<AnalyzeEstimateResponse>("/api/profiles/analyze/estimate"),
    analyzeProfiles: (body: AnalyzeRequest) =>
      request<{ job: Job }>("/api/profiles/analyze", json(body)),
    getProfileSuggestion: (runId?: string) =>
      request<ProfileSuggestion>(
        `/api/profiles/suggestion${runId ? `?runId=${encodeURIComponent(runId)}` : ""}`,
      ),
    getSalaryReference: (country: string) =>
      request<{ reference: SalaryReference | null }>(
        `/api/salary-reference?country=${encodeURIComponent(country)}`,
      ),
    getDashboard: () => request<Dashboard>("/api/dashboard"),
    // F03 §2.10 — GitHub, ingestão com orçamento, repositórios, notificações e configurações
    getGithubAuth: () => request<GithubAuthStatusResponse>("/api/github/auth"),
    setGithubAuthSource: (source: GithubAuthSource) =>
      request<GithubAuthStatusResponse>("/api/github/auth", {
        method: "PUT",
        body: JSON.stringify({ source }),
      }),
    startGithubDevice: () => request<GithubDeviceResponse>("/api/github/auth/device", json({})),
    disconnectGithub: () =>
      request<GithubAuthStatusResponse>("/api/github/auth", { method: "DELETE" }),
    previewGithub: (body: { mode: IngestionMode; login?: string }) =>
      request<GithubPreviewResponse>("/api/sources/github/preview", json(body)),
    getPlanUsage: () => request<{ usage: PlanUsage | null }>("/api/plan/usage"),
    getBackupSettings: () => request<BackupSettingsResponse>("/api/settings/backups"),
    putBackupSettings: (body: { max: number }) =>
      request<BackupSettingsResponse>("/api/settings/backups", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    getIngestSettings: () => request<IngestSettings>("/api/settings/ingest"),
    putIngestSettings: (body: Partial<IngestSettings>) =>
      request<IngestSettings>("/api/settings/ingest", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    estimateIngestion: (body: IngestionEstimateRequest) =>
      request<IngestionEstimateResponse>("/api/ingestions/estimate", json(body)),
    createGithubIngestion: (body: GithubIngestionCreateRequest) =>
      request<RunSummary>("/api/ingestions", json(body)),
    listIngestions: (opts: { status?: RunStatus[]; source?: string } = {}) => {
      const q = new URLSearchParams();
      if (opts.status?.length) q.set("status", opts.status.join(","));
      if (opts.source) q.set("source", opts.source);
      const qs = q.toString();
      return request<{ runs: RunSummary[] }>(`/api/ingestions${qs ? `?${qs}` : ""}`);
    },
    confirmIngestion: (id: string) =>
      request<{ status: RunStatus }>(`/api/ingestions/${encodeURIComponent(id)}/confirm`, json({})),
    decideIngestion: (id: string, body: IngestionDecisionRequest) =>
      request<{ status: RunStatus }>(
        `/api/ingestions/${encodeURIComponent(id)}/decision`,
        json(body),
      ),
    cancelIngestion: (id: string) =>
      request<{ status: RunStatus }>(`/api/ingestions/${encodeURIComponent(id)}/cancel`, json({})),
    retryIngestion: (id: string) =>
      request<{ status: RunStatus }>(`/api/ingestions/${encodeURIComponent(id)}/retry`, json({})),
    retryIngestionRepo: (id: string, fullName: string) =>
      request<{ status: RunStatus }>(
        `/api/ingestions/${encodeURIComponent(id)}/repos/retry`,
        json({ fullName }),
      ),
    listRepos: () => request<{ repos: Repo[] }>("/api/repos"),
    getRepo: (id: string) => request<RepoDetail>(`/api/repos/${encodeURIComponent(id)}`),
    putRepoDigest: (id: string, body: RepoDigestInput) =>
      request<{ digest: RepoDigest }>(`/api/repos/${encodeURIComponent(id)}/digest`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    reanalyzeRepo: (id: string, body: { kind?: "incremental" | "deepen" | "cover" }) =>
      request<RunSummary>(`/api/repos/${encodeURIComponent(id)}/reanalyze`, json(body)),
    listNotifications: (status: "open" | "resolved" | "all" = "open") =>
      request<NotificationsListResponse>(`/api/notifications?status=${status}`),
    readNotification: (id: string) =>
      request<{ notification: unknown }>(
        `/api/notifications/${encodeURIComponent(id)}/read`,
        json({}),
      ),
    dismissNotification: (id: string) =>
      request<{ notification: unknown }>(
        `/api/notifications/${encodeURIComponent(id)}/dismiss`,
        json({}),
      ),
    listSnapshots: () => request<SnapshotsList>("/api/snapshots"),
    deleteSnapshot: (id: string) =>
      request<{ ok: true }>(`/api/snapshots/${encodeURIComponent(id)}`, { method: "DELETE" }),
    pruneSnapshots: () =>
      request<{ removed: number; totalBytes: number; maxBytes: number }>("/api/snapshots/prune", {
        method: "POST",
      }),
    listFiles: () => request<{ files: EvidenceFile[] }>("/api/files"),
    getFileText: (id: string) =>
      request<{ text: string | null }>(`/api/files/${encodeURIComponent(id)}/text`),
    getFileDigest: (id: string) =>
      request<{ digest: FileDigest | null }>(`/api/files/${encodeURIComponent(id)}/digest`),
    // F06 · vagas
    listPostings: (q?: string) =>
      request<{ postings: Posting[] }>(
        q ? `/api/postings?q=${encodeURIComponent(q)}` : "/api/postings",
      ),
    getPosting: (id: string) => request<PostingDetail>(`/api/postings/${encodeURIComponent(id)}`),
    intakePosting: (body: { text?: string; url?: string; fields?: PostingPatch }) =>
      request<{ posting: Posting; job: Job | null }>("/api/postings/intake", json(body)),
    patchPosting: (id: string, patch: PostingPatch) =>
      request<{ posting: Posting }>(`/api/postings/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    deletePosting: (id: string) =>
      request<null>(`/api/postings/${encodeURIComponent(id)}`, { method: "DELETE" }),
    reextractPosting: (id: string) =>
      request<{ job: Job }>(`/api/postings/${encodeURIComponent(id)}/extract`, json({})),
    decideDuplicate: (id: string, action: "update" | "new" | "cancel") =>
      request<{ keptId: string | null; removedId: string | null }>(
        `/api/postings/${encodeURIComponent(id)}/duplicate-decision`,
        json({ action }),
      ),
    analyzePosting: (id: string) =>
      request<{ session: ChatSession }>(
        `/api/postings/${encodeURIComponent(id)}/analyze`,
        json({}),
      ),
    listPostingAnalyses: (id: string) =>
      request<{ analyses: PostingAnalysisView[] }>(
        `/api/postings/${encodeURIComponent(id)}/analyses`,
      ),
    addPostingContact: (id: string, body: PostingContactInput) =>
      request<{ contact: PostingContact }>(
        `/api/postings/${encodeURIComponent(id)}/contacts`,
        json(body),
      ),
    patchPostingContact: (id: string, contactId: string, body: Partial<PostingContactInput>) =>
      request<{ contact: PostingContact }>(
        `/api/postings/${encodeURIComponent(id)}/contacts/${encodeURIComponent(contactId)}`,
        { method: "PATCH", body: JSON.stringify(body) },
      ),
    deletePostingContact: (id: string, contactId: string) =>
      request<null>(
        `/api/postings/${encodeURIComponent(id)}/contacts/${encodeURIComponent(contactId)}`,
        { method: "DELETE" },
      ),
    addPostingNote: (id: string, body: string) =>
      request<{ note: PostingNote }>(
        `/api/postings/${encodeURIComponent(id)}/notes`,
        json({ body }),
      ),
    patchPostingNote: (id: string, noteId: string, body: string) =>
      request<{ note: PostingNote }>(
        `/api/postings/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`,
        { method: "PATCH", body: JSON.stringify({ body }) },
      ),
    decidePostingNote: (id: string, noteId: string, action: "confirm" | "reject") =>
      request<{ note: PostingNote }>(
        `/api/postings/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}/${action}`,
        json({}),
      ),
    deletePostingNote: (id: string, noteId: string) =>
      request<null>(`/api/postings/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`, {
        method: "DELETE",
      }),
    listPendingNotes: () => request<{ notes: PendingNote[] }>("/api/postings-pending-notes"),
    getModelSettings: () =>
      request<{ models: PostingModels; defaults: PostingModels }>("/api/settings/models"),
    // F05 · CV e carta
    listDocuments: (filter: { profileId?: string; postingId?: string }) => {
      const qs = new URLSearchParams(
        Object.entries(filter).filter((e): e is [string, string] => Boolean(e[1])),
      ).toString();
      return request<{ documents: DocumentView[] }>(`/api/documents${qs ? `?${qs}` : ""}`);
    },
    getDocument: (id: string) => request<DocumentView>(`/api/documents/${encodeURIComponent(id)}`),
    generateDocument: (body: GenerateDocumentBody) =>
      request<{ documents: DocumentView[] }>("/api/documents", json(body)),
    regenerateDocument: (
      id: string,
      body: { instructions?: string | null; acceptLanguage?: boolean },
    ) => request<DocumentView>(`/api/documents/${encodeURIComponent(id)}/regenerate`, json(body)),
    editDocument: (
      id: string,
      body: { baseVersion: number; cv?: CvDraft; letter?: CoverLetterDraft },
    ) =>
      request<DocumentView>(`/api/documents/${encodeURIComponent(id)}/content`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    changeDocumentLayout: (
      id: string,
      body: { templateId?: string; paper?: Paper; format?: CoverLetterFormat },
    ) =>
      request<DocumentView>(`/api/documents/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    documentDiff: (id: string, from: number, to: number) =>
      request<{ lines: Array<{ op: "=" | "+" | "-"; text: string }> }>(
        `/api/documents/${encodeURIComponent(id)}/diff?from=${from}&to=${to}`,
      ),
    listCvTemplates: () => request<{ templates: CvTemplateView[] }>("/api/cv-templates"),
    uploadCvTemplate: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<{ template: { id: string; status: string } }>("/api/cv-templates", {
        method: "POST",
        body: form,
      });
    },
    deleteCvTemplate: (id: string) =>
      request<null>(`/api/cv-templates/${encodeURIComponent(id)}`, { method: "DELETE" }),
    cvTemplatePreviewUrl: (id: string) =>
      `${base}/api/cv-templates/${encodeURIComponent(id)}/preview`,
    deleteDocument: (id: string) =>
      request<null>(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),
    /** Endereços para `<a download>` e `<img>`: a sessão vai pelo cookie (mesma origem). */
    documentPdfUrl: (id: string, version: number) =>
      `${base}/api/documents/${encodeURIComponent(id)}/versions/${version}/pdf`,
    documentPageUrl: (id: string, version: number, page: number) =>
      `${base}/api/documents/${encodeURIComponent(id)}/versions/${version}/pages/${page}`,
    putModelSettings: (patch: Partial<PostingModels>) =>
      request<{ models: PostingModels; defaults: PostingModels }>("/api/settings/models", {
        method: "PUT",
        body: JSON.stringify(patch),
      }),
  };
}

/** Detalhe da vaga (F06): campos, contatos, notas e outras vagas com a mesma identidade. */
export interface PostingDetail {
  posting: Posting;
  contacts: PostingContact[];
  notes: PostingNote[];
  duplicates: string[];
  /** Outras vagas da mesma empresa com o mesmo role (alerta da página). */
  related?: Posting[];
}
/** Análise gravada com a validade (F06-10) e os rótulos das evidências. */
export interface PostingAnalysisView {
  id: string;
  postingId: string;
  analysis: JobAnalysis;
  recommendedProfileId: string | null;
  factsVersion: number;
  postingUpdatedAt: string;
  models: string[];
  chatSessionId: string | null;
  createdAt: string;
  stale: { facts: boolean; posting: boolean };
  labels: Record<string, string>;
}
/** Edição do recrutador numa nota do usuário, esperando confirmação (bandeja "Aguardando você", F06-17). */
export interface PendingNote {
  note: PostingNote;
  posting: { id: string; company: string | null; title: string | null; role: string | null } | null;
}

/** F05 · documento (CV ou carta), versão atual, lista de versões, validade e links que faltam no cabeçalho. */
export type DocumentStatus =
  | "queued"
  | "collecting"
  | "generating"
  | "validating"
  | "rendering"
  | "checking"
  | "reviewing"
  | "retrying"
  | "ready"
  | "ready_with_issues"
  | "error";
export interface DocumentRecordView {
  id: string;
  kind: DocumentKind;
  profileId: string;
  postingId: string | null;
  templateId: string;
  paper: Paper;
  locale: CvLocale;
  format: CoverLetterFormat;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}
export interface DocumentVersionView {
  id: string;
  documentId: string;
  version: number;
  source: "agent" | "edit" | "recruiter" | "template";
  instructions: string | null;
  templateId: string;
  locale: CvLocale;
  paper: Paper;
  format: CoverLetterFormat;
  content: CvContent | CoverLetterContent | null;
  status: DocumentStatus;
  attempts: number;
  review: CvReview | null;
  atsScore: number | null;
  pagesRendered: number | null;
  pdfPath: string | null;
  textBody: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface DocumentView {
  document: DocumentRecordView;
  current: DocumentVersionView | null;
  versions: Array<{
    id: string;
    version: number;
    status: DocumentStatus;
    source: DocumentVersionView["source"];
    atsScore: number | null;
    pagesRendered: number | null;
    createdAt: string;
    passed: boolean | null;
  }>;
  stale: { facts: boolean; profile: boolean; posting: boolean } | null;
  missingLinks: CvLinkKind[];
}
/** Configurações › Processos (F05 M7): jobs simultâneos por fila. */
export interface WorkerSettings {
  concurrency: { ingest: number; ocr: number; extract: number };
  defaults: { ingest: number; ocr: number; extract: number };
  min: number;
  max: number;
}
/** Modelo de currículo (F05 §2.6): os três padrão e os enviados pela pessoa, com a validação. */
export interface CvTemplateView {
  id: string;
  name: string;
  origin: "builtin" | "user";
  status: "validating" | "valid" | "invalid";
  validationErrors: string[];
  hasPreview: boolean;
}
export interface GenerateDocumentBody {
  kind: DocumentKind;
  profileId: string;
  postingId?: string | null;
  instructions?: string | null;
  acceptLanguage?: boolean;
  format?: CoverLetterFormat;
  withCoverLetter?: boolean;
}

export type ApiClient = ReturnType<typeof createApiClient>;
