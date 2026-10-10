import type {
  AnalyzeEstimateResponse,
  AnalyzeRequest,
  BackupSettingsResponse,
  Budget,
  DashboardResponseSchema,
  EmphasisListResponse,
  EmphasisPutRequest,
  EstimateResponse,
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
  NotificationsListResponse,
  OnboardingState,
  PersonaOverrides,
  PersonaResponse,
  PlanUsage,
  Profile,
  ProfileCardResponse,
  ProfileCreateRequest,
  ProfilePatchRequest,
  ProfileSuggestionResponseSchema,
  ProviderStatusResponse,
  Repo,
  RepoAnalysis,
  RepoDigest,
  ReviewRequest,
  RunReport,
  RunStatus,
  SalaryReference,
  SnapshotsListResponseSchema,
  SuggestionsListResponse,
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
};
export type GithubAuthSource = z.infer<typeof GithubAuthSourceSchema>;
export type IngestSettings = z.infer<typeof IngestSettingsSchema>;
export type SnapshotsList = z.infer<typeof SnapshotsListResponseSchema>;
export interface RunSummary {
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
    cancelJob: (id: string) => request<Job>(`/api/jobs/${encodeURIComponent(id)}/cancel`, json({})),
    retryJob: (id: string) => request<Job>(`/api/jobs/${encodeURIComponent(id)}/retry`, json({})),
    getUsageSummary: () =>
      request<{
        totalTokens: number;
        byCategory: Record<string, number>;
        byModel: Record<string, number>;
      }>("/api/usage/summary"),
    getUser: () => request<{ user: User | null }>("/api/user"),
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
    getFileDigest: (id: string) =>
      request<{ digest: FileDigest | null }>(`/api/files/${encodeURIComponent(id)}/digest`),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
