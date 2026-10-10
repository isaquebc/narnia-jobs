/** Acesso direto à API nos testes: controle do mock, reset entre cenários e asserções sobre o que foi gravado. */
export const BASE_URL = process.env.BASE_URL ?? "http://web";
export const TOKEN = process.env.NARNIA_TOKEN ?? "e2e-token";

export interface MockMode {
  installed?: boolean;
  loggedIn?: boolean;
  authMethod?: "claude.ai" | "oauth_token" | "api_key" | "api_key_helper" | "third_party";
  delayMs?: number;
  errors?: Partial<Record<"detect" | "readDocument" | "extractFacts" | "buildDigest", string>>;
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${TOKEN}`);
  if (init.body && typeof init.body === "string" && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  if (!res.ok)
    throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export const reset = () => api<{ ok: boolean }>("/api/_test/reset", { method: "POST" });

export const setMock = (mode: MockMode) =>
  api("/api/_test/mock", { method: "POST", body: JSON.stringify(mode) });

export interface OnboardingState {
  step: number;
  completed: boolean;
  runId?: string;
  fileId?: string;
}
export const onboarding = () => api<OnboardingState>("/api/onboarding/state");

export interface Proposal {
  id: string;
  proposal: { kind: string; data: Record<string, unknown> };
  decision: "pending" | "accepted" | "edited" | "rejected";
  origin: string | null;
  editedData?: Record<string, unknown> | null;
}
export interface Ingestion {
  id: string;
  status: string;
  jobs: Array<{ id: string; type: string; status: string }>;
  proposals: Proposal[];
  readings: Array<{ kind: string; quality: number | null }>;
  segments: Array<{ origin: string; agreement: number; divergences?: unknown }>;
  digest: { summary: string } | null;
}
export const ingestion = (id: string) => api<Ingestion>(`/api/ingestions/${id}`);

export const jobs = () =>
  api<{ jobs: Array<{ id: string; status: string; stage: string; parentId: string | null }> }>(
    "/api/jobs",
  );

export interface Profile {
  id: string;
  salary?: { min: number; max: number; currency: string; period: string };
  salaryBelowReference: boolean;
  needsResearch: string[];
  updatedAt?: string;
  createdAt?: string;
}
export const profiles = () => api<{ profiles: Profile[] }>("/api/profiles");

export const dashboard = () =>
  api<{
    profile: Profile | null;
    counts: { experiences: number; skills: number; education: number; files: number };
    usage: { totalTokens: number };
    pendingResearch: number;
  }>("/api/dashboard");

export const user = () =>
  api<{ user: { timezone: string; phone: { e164: string } } | null }>("/api/user");

export const salaryReference = (country = "BR") =>
  api<{ reference: { value: number; currency: string; referenceMonth: string } | null }>(
    `/api/salary-reference?country=${country}`,
  );

/** Espera até `pred` ser verdadeiro para o valor de `fn`, consultando a cada `everyMs`. */
export async function waitFor<T>(
  fn: () => Promise<T>,
  pred: (v: T) => boolean,
  { timeoutMs = 120_000, everyMs = 1_000, label = "condição" } = {},
): Promise<T> {
  const t0 = Date.now();
  let last: T | undefined;
  while (Date.now() - t0 < timeoutMs) {
    last = await fn();
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`timeout esperando ${label}: ${JSON.stringify(last)}`);
}

/** Converte um instante UTC para o texto que a UI mostra (DD/MM/YYYY HH:mm) no fuso dado, sem moment. */
export function formatInTz(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}/${get("minute")}`.replace(
    /(\d{2})\/(\d{2})$/,
    "$1:$2",
  );
}

/** Limiar de autoconfirmação da ingestão (F03-13); 0 = sempre confirmar. Volta ao padrão no próximo `reset`. */
export const setAutoConfirmBelow = (tokens: number) =>
  api("/api/settings/ingest", {
    method: "PUT",
    body: JSON.stringify({ autoConfirmBelow: tokens }),
  });
