import type {
  AddressForm,
  AnalyzeEstimateResponse,
  AnalyzeRequest,
  ApplicationFormView,
  ApplyOptions,
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
  ExtensionCapture,
  ExtensionCaptureActivityResponse,
  ExtensionDevicesResponse,
  ExtensionPairingResponse,
  FactAliasDto,
  FileDigest,
  FileResponse,
  GithubAuthSourceSchema,
  GithubAuthStatusResponse,
  GithubDeviceResponse,
  GithubIngestionCreateRequest,
  GithubMetrics,
  GithubPreviewResponse,
  GmailStatusView,
  IngestionCreateRequest,
  IngestionDecisionRequest,
  IngestionEstimateRequest,
  IngestionEstimateResponse,
  IngestionMode,
  IngestionResponse,
  IngestSettingsSchema,
  Job,
  JobAnalysis,
  JobApplicationCreate,
  JobApplicationEntry,
  JobApplicationEntryPatch,
  JobApplicationEvent,
  JobApplicationEventInput,
  JobApplicationEventPatch,
  JobApplicationFunnel,
  JobApplicationPatch,
  JobApplicationReject,
  JobApplicationStagesPut,
  JobApplicationSummary,
  JobApplicationUpcoming,
  MailSendersView,
  MailSettingsView,
  MediaStatus,
  MotivationStatus,
  NotificationsListResponse,
  OnboardingState,
  Paper,
  PersonaOverrides,
  PersonaResponse,
  PlanUsage,
  PluginStatusResponse,
  Posting,
  PostingArchiveRequest,
  PostingContact,
  PostingContactInput,
  PostingListItem,
  PostingModels,
  PostingNote,
  PostingPatch,
  Profile,
  ProfileCardResponse,
  ProfileCreateRequest,
  ProfileMotivation,
  ProfilePatchRequest,
  ProfileSuggestionResponseSchema,
  ProviderStatusResponse,
  Recording,
  RecordingAnalysis,
  RecordingCreate,
  RecordingLimits,
  RecordingPerson,
  RecordingPersonPatch,
  RecordingTurn,
  Repo,
  RepoAnalysis,
  RepoDigest,
  ResearchSource,
  ReviewRequest,
  RunOrigin,
  RunReport,
  RunStatus,
  SalaryReference,
  SavedPostingCard,
  ScheduledRun,
  ScheduledRunDetail,
  ScheduledTask,
  ScheduledTaskPatch,
  SnapshotsListResponseSchema,
  SuggestionsListResponse,
  TodoCreate,
  TodoItem,
  TodoListResponse,
  TodoMove,
  TodoPatch,
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

/** F14/M6 · atividade de e-mail na candidatura. */
export interface MailActivity {
  mails: Array<{
    id: string;
    gmailId: string;
    subject: string | null;
    from: string | null;
    receivedAt: string;
    class: string | null;
    summary: string | null;
    undoneAt: string | null;
    canUndo: boolean;
    mailUrl: string;
  }>;
  suggestions: Array<{
    id: string;
    toStageId: string | null;
    toStageName: string;
    hint: string | null;
    confidence: number;
    createdAt: string;
    mailMessageId: string;
  }>;
  stageChanges: Array<{
    id: string;
    at: string;
    source: "manual" | "email" | "suggestion";
    mailMessageId: string | null;
    fromStageName: string | null;
    toStageName: string | null;
  }>;
}

/** F14-2 · aprendizado do movimento de etapa. */
export interface StageLearningView {
  allowed: boolean;
  decisions: number;
  accuracy: number | null;
  lastUndoAt: string | null;
  active: boolean;
  reason: "off" | "few_decisions" | "low_accuracy" | "recent_undo" | null;
  minDecisions: number;
  minAccuracy: number;
}

/** F14/M5 · item da caixa de revisão ou da quarentena. */
export interface MailReviewItem {
  id: string;
  gmailId: string;
  status: string;
  class: string | null;
  from: string | null;
  fromAddr: string | null;
  subject: string | null;
  receivedAt: string;
  riskLevel: string | null;
  riskReasons: string[];
  summary: string | null;
  reason: string | null;
  company: string | null;
  title: string | null;
  mailUrl: string;
  /** Vaga que o narnia achou, quando falta só a confirmação da pessoa. */
  suggestedPosting: { id: string; title: string | null; company: string | null } | null;
  /** Remetente sem confiança: a ação automática espera "Aplicar mesmo assim". */
  needsConfirm: boolean;
}

/** F14-6, F14-7, F14-10: configurações do feed. */
export interface FeedSettingsView {
  preanalysisCut: number;
  preanalysisDailyCap: number;
  linksPerRun: number;
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
    // Configurações › Extensão do navegador (F12/M1)
    createExtensionPairing: () =>
      request<ExtensionPairingResponse>("/api/extension/pairing", { method: "POST" }),
    listExtensionDevices: () => request<ExtensionDevicesResponse>("/api/extension/devices"),
    revokeExtensionDevice: (id: string) =>
      request<void>(`/api/extension/devices/${encodeURIComponent(id)}`, { method: "DELETE" }),
    // janela da extensão (F12/M2): página lida e "Salvar vaga"
    getCaptureActivity: (ids: string[]) =>
      request<ExtensionCaptureActivityResponse>(
        `/api/extension/captures/activity?ids=${ids.map(encodeURIComponent).join(",")}`,
      ),
    getExtensionCapture: (id: string) =>
      request<{ capture: ExtensionCapture }>(`/api/extension/captures/${encodeURIComponent(id)}`),
    saveCapturePosting: (id: string) =>
      request<{ posting: Posting; job: Job | null }>(
        `/api/extension/captures/${encodeURIComponent(id)}/posting`,
        { method: "POST" },
      ),
    /** "Analisar de novo" na janela da extensão: abre a conversa da análise da vaga salva. */
    getApplication: (id: string) =>
      request<{ application: ApplicationFormView }>(`/api/applications/${encodeURIComponent(id)}`),
    linkApplicationPosting: (id: string, postingId: string | null) =>
      request<{ application: ApplicationFormView }>(`/api/applications/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postingId }),
      }),
    generateApplicationAnswers: (id: string) =>
      request<{ job: Job | null }>(`/api/applications/${encodeURIComponent(id)}/answers`, {
        method: "POST",
      }),
    /** A pessoa editou a resposta antes de preencher (F12-19). */
    /** Conversa do formulário (F12/M5): a primeira mensagem cria, as próximas seguem nela. */
    openApplicationChat: (id: string, message: string) =>
      request<{ session: ChatSession }>(`/api/applications/${encodeURIComponent(id)}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      }),
    editApplicationAnswer: (id: string, questionId: string, answer: string) =>
      request<{ application: ApplicationFormView }>(
        `/api/applications/${encodeURIComponent(id)}/answers/${encodeURIComponent(questionId)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answer }),
        },
      ),
    /** F12-23: suposição do roleplay aceita (vira motivação do perfil) ou recusada (refaz a pergunta). */
    decideAssumption: (
      id: string,
      questionId: string,
      body: { index: number; action: "accept" | "refuse"; text?: string },
    ) =>
      request<{ application: ApplicationFormView }>(
        `/api/applications/${encodeURIComponent(id)}/answers/${encodeURIComponent(questionId)}/assumptions`,
        json(body),
      ),
    /** F12-23: motivações do perfil, decididas pela pessoa. */
    listMotivations: (profileId: string) =>
      request<{ items: ProfileMotivation[]; reviewed: boolean; suggesting: boolean }>(
        `/api/profiles/${encodeURIComponent(profileId)}/motivations`,
      ),
    suggestMotivations: (profileId: string) =>
      request<{ job: Job | null }>(
        `/api/profiles/${encodeURIComponent(profileId)}/motivations/suggest`,
        { method: "POST" },
      ),
    addMotivation: (profileId: string, text: string) =>
      request<{ motivation: ProfileMotivation }>(
        `/api/profiles/${encodeURIComponent(profileId)}/motivations`,
        json({ text }),
      ),
    patchMotivation: (
      profileId: string,
      id: string,
      patch: { text?: string; status?: MotivationStatus },
    ) =>
      request<{ motivation: ProfileMotivation }>(
        `/api/profiles/${encodeURIComponent(profileId)}/motivations/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        },
      ),
    reviewMotivations: (profileId: string) =>
      request<{ reviewed: boolean }>(
        `/api/profiles/${encodeURIComponent(profileId)}/motivations/review`,
        { method: "POST" },
      ),
    /** F12-23: como o narnia se refere à pessoa (nunca pelo nome). */
    setAddressForm: (address: AddressForm) =>
      request<{ user: User }>("/api/user/address", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      }),
    relocateApplication: (id: string) =>
      request<{ job: Job | null }>(`/api/applications/${encodeURIComponent(id)}/locate`, {
        method: "POST",
      }),
    analyzeCapture: (id: string) =>
      request<{ session: ChatSession }>(
        `/api/extension/captures/${encodeURIComponent(id)}/analyze`,
        { method: "POST" },
      ),
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
    listFactAliases: () => request<{ aliases: FactAliasDto[] }>("/api/settings/fact-aliases"),
    deleteFactAlias: (id: string) =>
      request<void>(`/api/settings/fact-aliases/${encodeURIComponent(id)}`, { method: "DELETE" }),
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
    // F15 · tarefas (kanban)
    listTodos: (
      f: {
        q?: string | undefined;
        tag?: string | undefined;
        source?: "manual" | "email" | undefined;
        applicationId?: string | undefined;
        overdue?: boolean | undefined;
      } = {},
    ) => {
      const qs = new URLSearchParams();
      if (f.q) qs.set("q", f.q);
      if (f.tag) qs.set("tag", f.tag);
      if (f.source) qs.set("source", f.source);
      if (f.applicationId) qs.set("applicationId", f.applicationId);
      if (f.overdue) qs.set("overdue", "1");
      const s = qs.toString();
      return request<TodoListResponse>(`/api/todos${s ? `?${s}` : ""}`);
    },
    createTodo: (body: TodoCreate) => request<TodoItem>("/api/todos", json(body)),
    patchTodo: (id: string, body: TodoPatch) =>
      request<TodoItem>(`/api/todos/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    moveTodo: (id: string, body: TodoMove) =>
      request<TodoItem>(`/api/todos/${encodeURIComponent(id)}/move`, json(body)),
    deleteTodo: (id: string) =>
      request<void>(`/api/todos/${encodeURIComponent(id)}`, { method: "DELETE" }),
    listJobs: () => request<{ jobs: Job[] }>("/api/jobs"),
    listScheduledTasks: () => request<{ tasks: ScheduledTask[] }>("/api/scheduled-tasks"),
    patchScheduledTask: (id: string, patch: ScheduledTaskPatch) =>
      request<ScheduledTask>(`/api/scheduled-tasks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    runScheduledTask: (id: string) =>
      request<{ jobId: string; enqueued: boolean }>(
        `/api/scheduled-tasks/${encodeURIComponent(id)}/run`,
        json({}),
      ),
    listScheduledRuns: (id: string) =>
      request<{ runs: ScheduledRun[] }>(`/api/scheduled-tasks/${encodeURIComponent(id)}/runs`),
    getScheduledRun: (id: string) =>
      request<ScheduledRunDetail>(`/api/scheduled-runs/${encodeURIComponent(id)}`),
    /** Sem `runId`: todas as leituras. */
    redoMailRuns: (runId: string | null) =>
      request<{
        mails: number;
        applicationsRemoved: number;
        postingsRemoved: number;
        kept: Array<{ gmailId: string; subject: string | null; reason: string }>;
      }>("/api/mail/redo", json({ runId })),
    /** "Ler de novo este e-mail": aceita o id do e-mail ou o do Gmail. */
    rereadMail: (id: string) =>
      request<{
        mails: number;
        applicationsRemoved: number;
        postingsRemoved: number;
        kept: Array<{ gmailId: string; subject: string | null; reason: string }>;
      }>(`/api/mail/${encodeURIComponent(id)}/reread`, { method: "POST" }),
    getWorkerSettings: () => request<WorkerSettings>("/api/settings/workers"),
    getSemanticSearch: () => request<SemanticSearchView>("/api/settings/semantic-search"),
    putSemanticSearch: (body: { enabled: boolean }) =>
      request<SemanticSearchView>("/api/settings/semantic-search", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
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
    /** F07: cada vaga com a candidatura dela; `archived` lista só as arquivadas. */
    listPostings: (q?: string, archived?: boolean) => {
      const qs = new URLSearchParams();
      if (q) qs.set("q", q);
      if (archived) qs.set("archived", "1");
      const s = qs.toString();
      return request<{ postings: PostingListItem[] }>(`/api/postings${s ? `?${s}` : ""}`);
    },
    /** F14: feed das vagas vindas de e-mail (não arquivadas, pelo match). */
    listFeed: () => request<{ postings: PostingListItem[] }>("/api/postings?feed=1"),
    getFeedSettings: () => request<FeedSettingsView>("/api/mail/feed-settings"),
    putFeedSettings: (patch: Partial<FeedSettingsView>) =>
      request<FeedSettingsView>("/api/mail/feed-settings", {
        method: "PUT",
        body: JSON.stringify(patch),
      }),
    archivePosting: (id: string, body: PostingArchiveRequest) =>
      request<{ posting: Posting }>(`/api/postings/${encodeURIComponent(id)}/archive`, json(body)),
    /** Separar a vaga das iguais (ou juntar de novo), pedido do dono 2026-11-12. */
    setPostingGroupSplit: (id: string, split: boolean) =>
      request<{ posting: Posting }>(
        `/api/postings/${encodeURIComponent(id)}/group`,
        json({ split }),
      ),
    unarchivePosting: (id: string) =>
      request<{ posting: Posting }>(`/api/postings/${encodeURIComponent(id)}/unarchive`, json({})),
    getPosting: (id: string) => request<PostingDetail>(`/api/postings/${encodeURIComponent(id)}`),
    /** F14-9: a página da vaga foi aberta (interação; tira o "nova" do feed). */
    markPostingSeen: (id: string) =>
      request<void>(`/api/postings/${encodeURIComponent(id)}/seen`, json({})),
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
    /** Fixa o contato no topo da página da vaga (um por vaga) ou solta. */
    pinPostingContact: (id: string, contactId: string, pinned: boolean) =>
      request<{ contact: PostingContact }>(
        `/api/postings/${encodeURIComponent(id)}/contacts/${encodeURIComponent(contactId)}/pin`,
        json({ pinned }),
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
    // F07 · candidaturas
    getApplyOptions: (postingId: string) =>
      request<ApplyOptions>(`/api/postings/${encodeURIComponent(postingId)}/apply-options`),
    createJobApplication: (body: JobApplicationCreate) =>
      request<{ application: JobApplicationSummary }>("/api/job-applications", json(body)),
    listJobApplications: (filter: { q?: string; archived?: boolean }) => {
      const qs = new URLSearchParams();
      if (filter.q) qs.set("q", filter.q);
      if (filter.archived) qs.set("archived", "1");
      const s = qs.toString();
      return request<{ applications: JobApplicationSummary[]; saved: SavedPostingCard[] }>(
        `/api/job-applications${s ? `?${s}` : ""}`,
      );
    },
    getJobApplication: (id: string) =>
      request<{ application: JobApplicationSummary }>(
        `/api/job-applications/${encodeURIComponent(id)}`,
      ),
    patchJobApplication: (id: string, patch: JobApplicationPatch) =>
      request<{ application: JobApplicationSummary }>(
        `/api/job-applications/${encodeURIComponent(id)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      ),
    rejectJobApplication: (id: string, body: JobApplicationReject) =>
      request<{ application: JobApplicationSummary }>(
        `/api/job-applications/${encodeURIComponent(id)}/reject`,
        { method: "POST", body: JSON.stringify(body) },
      ),
    putJobApplicationStages: (id: string, stages: JobApplicationStagesPut["stages"]) =>
      request<{ application: JobApplicationSummary }>(
        `/api/job-applications/${encodeURIComponent(id)}/stages`,
        { method: "PUT", body: JSON.stringify({ stages }) },
      ),
    listJobApplicationEntries: (id: string) =>
      request<{ entries: JobApplicationEntry[] }>(
        `/api/job-applications/${encodeURIComponent(id)}/entries`,
      ),
    createJobApplicationEntry: (
      id: string,
      input: { occurredOn: string; body: string | null; files: File[] },
    ) => {
      const form = new FormData();
      form.set("occurredOn", input.occurredOn);
      if (input.body) form.set("body", input.body);
      for (const f of input.files) form.append("files", f);
      return request<{ entry: JobApplicationEntry }>(
        `/api/job-applications/${encodeURIComponent(id)}/entries`,
        { method: "POST", body: form },
      );
    },
    patchJobApplicationEntry: (id: string, entryId: string, patch: JobApplicationEntryPatch) =>
      request<{ entry: JobApplicationEntry }>(
        `/api/job-applications/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      ),
    deleteJobApplicationEntry: (id: string, entryId: string) =>
      request<null>(
        `/api/job-applications/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}`,
        { method: "DELETE" },
      ),
    jobApplicationAttachmentUrl: (id: string, attachmentId: string) =>
      `${base}/api/job-applications/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`,
    listJobApplicationEvents: (id: string) =>
      request<{ events: JobApplicationEvent[] }>(
        `/api/job-applications/${encodeURIComponent(id)}/events`,
      ),
    createJobApplicationEvent: (id: string, input: JobApplicationEventInput) =>
      request<{ event: JobApplicationEvent }>(
        `/api/job-applications/${encodeURIComponent(id)}/events`,
        json(input),
      ),
    patchJobApplicationEvent: (id: string, eventId: string, patch: JobApplicationEventPatch) =>
      request<{ event: JobApplicationEvent }>(
        `/api/job-applications/${encodeURIComponent(id)}/events/${encodeURIComponent(eventId)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      ),
    deleteJobApplicationEvent: (id: string, eventId: string) =>
      request<null>(
        `/api/job-applications/${encodeURIComponent(id)}/events/${encodeURIComponent(eventId)}`,
        { method: "DELETE" },
      ),
    /** F14-3: bloquear (ou não) a agenda para a etapa provisória. */
    blockJobApplicationEvent: (appId: string, eventId: string, blocked: boolean) =>
      request<{ event: JobApplicationEvent }>(
        `/api/job-applications/${encodeURIComponent(appId)}/events/${encodeURIComponent(eventId)}/block`,
        json({ blocked }),
      ),
    /** F14-5, F14-15: perfil e CV da candidatura vinda de e-mail. */
    putJobApplicationProfileCv: (
      appId: string,
      body: { profileId?: string; cvVersionId?: string | null },
    ) =>
      request<{ application: JobApplicationSummary }>(
        `/api/job-applications/${encodeURIComponent(appId)}/profile-cv`,
        { method: "PUT", body: JSON.stringify(body) },
      ),
    /** F14/M6: o que os e-mails fizeram na candidatura. */
    getMailActivity: (appId: string) =>
      request<MailActivity>(`/api/job-applications/${encodeURIComponent(appId)}/mail-activity`),
    approveStageSuggestion: (id: string, stageId?: string) =>
      request<{ application: unknown }>(
        `/api/stage-suggestions/${encodeURIComponent(id)}/approve`,
        json(stageId ? { stageId } : {}),
      ),
    rejectStageSuggestion: (id: string) =>
      request<void>(`/api/stage-suggestions/${encodeURIComponent(id)}/reject`, json({})),
    undoMail: (id: string) =>
      request<{ applicationId: string | null; applicationRemoved: boolean; skipped: string[] }>(
        `/api/mail/${encodeURIComponent(id)}/undo`,
        json({}),
      ),
    getStageLearning: () => request<StageLearningView>("/api/mail/stage-learning"),
    putStageLearning: (allowed: boolean) =>
      request<StageLearningView>("/api/mail/stage-learning", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowed }),
      }),
    jobApplicationEventIcsUrl: (id: string, eventId: string) =>
      `${base}/api/job-applications/${encodeURIComponent(id)}/events/${encodeURIComponent(eventId)}/calendar.ics`,
    getJobApplicationUpcoming: (hours = 24) =>
      request<JobApplicationUpcoming>(`/api/job-applications/upcoming?hours=${hours}`),
    getJobApplicationFunnel: () => request<JobApplicationFunnel>("/api/job-applications/funnel"),
    // F13 · Configurações › Análise de vídeo (serviço media e token do Hugging Face) e entrevistas gravadas
    getMediaStatus: () => request<MediaStatus>("/api/media/status"),
    putMediaToken: (token: string) =>
      request<MediaStatus>("/api/media/token", { method: "PUT", body: JSON.stringify({ token }) }),
    deleteMediaToken: () => request<MediaStatus>("/api/media/token", { method: "DELETE" }),
    getRecordingSettings: () => request<RecordingLimits>("/api/settings/recordings"),
    putRecordingSettings: (body: RecordingLimits) =>
      request<RecordingLimits>("/api/settings/recordings", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    listRecordings: (by: { jobApplicationId: string } | { profileId: string }) =>
      request<{ recordings: Recording[] }>(
        `/api/recordings?${new URLSearchParams(by as Record<string, string>).toString()}`,
      ),
    createRecording: (input: RecordingCreate) => request<Recording>("/api/recordings", json(input)),
    /** Uma parte do vídeo (até 8 MB), a partir de `offset`; a resposta diz quantos bytes já chegaram. */
    putRecordingChunk: (id: string, offset: number, chunk: Blob) =>
      request<Recording>(`/api/recordings/${encodeURIComponent(id)}/video?offset=${offset}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: chunk,
      }),
    deleteRecordingVideo: (id: string) =>
      request<Recording>(`/api/recordings/${encodeURIComponent(id)}/video`, { method: "DELETE" }),
    deleteRecording: (id: string) =>
      request<void>(`/api/recordings/${encodeURIComponent(id)}`, { method: "DELETE" }),
    recordingVideoUrl: (id: string) => `${base}/api/recordings/${encodeURIComponent(id)}/video`,
    // F13/M4–M6: análise, correções, quadros, relatório e conversa
    getRecording: (id: string) => request<Recording>(`/api/recordings/${encodeURIComponent(id)}`),
    getRecordingAnalysis: (id: string) =>
      request<RecordingAnalysis>(`/api/recordings/${encodeURIComponent(id)}/analysis`),
    analyzeRecording: (id: string) =>
      request<Recording>(`/api/recordings/${encodeURIComponent(id)}/analyze`, { method: "POST" }),
    regenerateRecordingReport: (id: string) =>
      request<Recording>(`/api/recordings/${encodeURIComponent(id)}/report`, { method: "POST" }),
    patchRecordingPerson: (id: string, personId: string, patch: RecordingPersonPatch) =>
      request<RecordingPerson>(
        `/api/recordings/${encodeURIComponent(id)}/persons/${encodeURIComponent(personId)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      ),
    patchRecordingTurn: (id: string, turnId: string, personId: string) =>
      request<RecordingTurn>(
        `/api/recordings/${encodeURIComponent(id)}/turns/${encodeURIComponent(turnId)}`,
        { method: "PATCH", body: JSON.stringify({ personId }) },
      ),
    recordingFrameUrl: (id: string, file: string) =>
      `${base}/api/recordings/${encodeURIComponent(id)}/frames/${encodeURIComponent(file)}`,
    openRecordingChat: (id: string, message: string) =>
      request<{ session: ChatSession }>(
        `/api/recordings/${encodeURIComponent(id)}/chat`,
        json({ message }),
      ),
    getGmailStatus: () => request<GmailStatusView>("/api/integrations/gmail"),
    putGmailClient: (body: { clientId: string; clientSecret: string }) =>
      request<GmailStatusView>("/api/integrations/gmail/client", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    deleteGmailClient: () =>
      request<GmailStatusView>("/api/integrations/gmail/client", { method: "DELETE" }),
    connectGmail: () =>
      request<GmailStatusView & { authUrl: string }>("/api/integrations/gmail/connect", json({})),
    disconnectGmail: () =>
      request<GmailStatusView>("/api/integrations/gmail", { method: "DELETE" }),
    getMailSettings: () => request<MailSettingsView>("/api/mail/settings"),
    listMailSenders: () => request<MailSendersView>("/api/mail/senders"),
    getMailReview: () =>
      request<{ review: MailReviewItem[]; quarantine: MailReviewItem[] }>("/api/mail/review"),
    ignoreMail: (id: string) =>
      request<MailReviewItem>(`/api/mail/${encodeURIComponent(id)}/ignore`, json({})),
    applyMail: (id: string, body: { postingId: string } | { confirm: true }) =>
      request<{ status: string }>(`/api/mail/${encodeURIComponent(id)}/apply`, json(body)),
    processQuarantinedMail: (id: string) =>
      request<{ status: string }>(`/api/mail/${encodeURIComponent(id)}/process`, json({})),
    putMailSender: (body: { value: string; override: "trusted" | "blocked" }) =>
      request<MailSendersView & { quarantined: number }>("/api/mail/senders", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    deleteMailSender: (value: string) =>
      request<MailSendersView>(`/api/mail/senders/${encodeURIComponent(value)}`, {
        method: "DELETE",
      }),
    reprocessMailSender: (value: string) =>
      request<{ reprocessed: number }>(
        `/api/mail/senders/${encodeURIComponent(value)}/reprocess`,
        json({}),
      ),
    putMailSettings: (since: string) =>
      request<MailSettingsView>("/api/mail/settings", {
        method: "PUT",
        body: JSON.stringify({ since }),
      }),
    getGoogleCalendarStatus: (refresh = false) =>
      request<{
        status: "connected" | "needs_auth" | "not_configured" | "error" | "unavailable";
        detail: string | null;
        mcpUrl: string;
        callbackPort: number;
        redirectUri: string;
        steps: { add: string; login: string };
      }>(`/api/integrations/google-calendar/status${refresh ? "?refresh=1" : ""}`),
    openJobApplicationChat: (id: string, message: string) =>
      request<{ session: ChatSession }>(
        `/api/job-applications/${encodeURIComponent(id)}/chat`,
        json({ message }),
      ),
    deleteJobApplication: (id: string) =>
      request<null>(`/api/job-applications/${encodeURIComponent(id)}`, { method: "DELETE" }),
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
    /** "Regerar com mensagem": abre a conversa da vaga com o documento e o pedido do usuário. */
    documentFeedback: (id: string, message: string) =>
      request<{ session: ChatSession }>(
        `/api/documents/${encodeURIComponent(id)}/feedback`,
        json({ message }),
      ),
    regenerateDocument: (
      id: string,
      body: { instructions?: string | null; acceptLanguage?: boolean; fixIssues?: boolean },
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
/** Configurações › Busca por sentido (R6, FF-5, FF-7). */
export interface SemanticSearchView {
  enabled: boolean;
  status: "off" | "loading" | "indexing" | "ready" | "error";
  progress: number | null;
  error: string | null;
  model: string;
  cutFacts: number;
  alert: boolean;
  vectors: number;
}
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
