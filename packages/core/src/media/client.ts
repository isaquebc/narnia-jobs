import type { MediaStatus } from "@narnia-jobs/shared";

/**
 * Cliente do serviço `media` da F13 (Python, perfil Docker opcional; plans/plan-v0/tasks/done/F13 §6.1.1, R1, R2 e R4).
 * Quem processa é o worker; o api só consulta o estado e grava o token. O token do Hugging Face passa por aqui uma
 * vez, no corpo do `PUT /token`, e nunca entra em mensagem de erro, log ou resposta.
 */

export const MEDIA_ENABLE_COMMAND = "./start.sh media on";
const HEALTH_TIMEOUT_MS = 3000;
const CALL_TIMEOUT_MS = 60_000;

export type MediaErrorCode =
  | "media_off"
  | "invalid_token"
  | "token_rejected"
  | "busy"
  | "no_video"
  | "unknown_run"
  | "media_error";

export class MediaError extends Error {
  readonly code: MediaErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  constructor(
    code: MediaErrorCode,
    status: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "MediaError";
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

export interface MediaRun {
  id: string;
  interview_id: string;
  state: "running" | "done" | "failed";
  step: string | null;
  /** Etapas pedidas nesta execução (o worker que reinicia acompanha a execução anterior por elas). */
  steps?: string[];
  progress: number;
  step_progress?: number;
  results?: Record<string, unknown>;
  skipped: string[];
  error: { code: string; message: string; step: string | null } | null;
}

interface Health {
  ok: boolean;
  version: string;
  token: boolean;
  busy: boolean;
  steps: string[];
}

const KNOWN: ReadonlySet<string> = new Set([
  "invalid_token",
  "token_rejected",
  "busy",
  "no_video",
  "unknown_run",
]);

export class MediaClient {
  private readonly base: string | null;
  constructor(
    baseUrl: string | null | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = baseUrl ? baseUrl.replace(/\/+$/, "") : null;
  }

  /** Do ambiente: `NARNIA_MEDIA_URL` (vazio = desligado). */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): MediaClient {
    return new MediaClient(env.NARNIA_MEDIA_URL || null);
  }

  get configured(): boolean {
    return this.base !== null;
  }

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = CALL_TIMEOUT_MS,
  ): Promise<T> {
    if (!this.base)
      throw new MediaError("media_off", 503, "O serviço de análise de vídeo está desligado.");
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new MediaError("media_off", 503, "O serviço de análise de vídeo não respondeu.");
    }
    const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return out as T;
    const code = typeof out.error === "string" && KNOWN.has(out.error) ? out.error : "media_error";
    const message =
      typeof out.message === "string" ? out.message : `O serviço de vídeo respondeu ${res.status}.`;
    const details = typeof out.run_id === "string" ? { runId: out.run_id } : undefined;
    throw new MediaError(code as MediaErrorCode, res.status, message, details);
  }

  async status(): Promise<MediaStatus> {
    const off: MediaStatus = {
      state: "off",
      enableCommand: MEDIA_ENABLE_COMMAND,
      version: null,
      busy: false,
      steps: [],
    };
    if (!this.base) return off;
    let h: Health;
    try {
      h = await this.call<Health>("GET", "/health", undefined, HEALTH_TIMEOUT_MS);
    } catch {
      return off;
    }
    return {
      state: h.token ? "ready" : "needs_token",
      enableCommand: MEDIA_ENABLE_COMMAND,
      version: h.version ?? null,
      busy: Boolean(h.busy),
      steps: Array.isArray(h.steps) ? h.steps : [],
    };
  }

  async setToken(token: string): Promise<void> {
    await this.call("PUT", "/token", { token: token.trim() });
  }

  async deleteToken(): Promise<void> {
    await this.call("DELETE", "/token");
  }

  async startRun(
    interviewId: string,
    steps: string[],
    options: Record<string, unknown> = {},
  ): Promise<{ id: string }> {
    return this.call("POST", "/runs", { interview_id: interviewId, steps, options });
  }

  /** `brief`: sem os resultados (o worker lê os JSON da pasta compartilhada). */
  async getRun(id: string, opts: { brief?: boolean } = {}): Promise<MediaRun> {
    return this.call("GET", `/runs/${encodeURIComponent(id)}${opts.brief ? "?brief=1" : ""}`);
  }
}
