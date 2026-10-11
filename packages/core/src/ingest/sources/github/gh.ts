import { execFile } from "node:child_process";

/**
 * Cliente mínimo sobre o `gh api` (F03-1, F03 §2.3). O `exec` é injetável (testes usam respostas gravadas); o
 * token, quando existe, vai só no ambiente do processo (`GH_TOKEN`), nunca em argumento, mensagem de erro ou log.
 */
export interface GhExecResult {
  stdout: string;
  stderr: string;
  code: number;
}
export type GhExec = (args: string[]) => Promise<GhExecResult>;

export type GhErrorCode =
  | "not_authenticated"
  | "rate_limited"
  | "not_found"
  | "unavailable"
  | "empty"
  | "failed";

export class GhError extends Error {
  readonly code: GhErrorCode;
  readonly status: number | null;
  readonly retryAfterSec: number | null;
  /** stderr já sem segredos. */
  readonly stderr: string;
  constructor(
    code: GhErrorCode,
    message: string,
    opts: { status?: number | null; retryAfterSec?: number | null; stderr?: string } = {},
  ) {
    super(message);
    this.name = "GhError";
    this.code = code;
    this.status = opts.status ?? null;
    this.retryAfterSec = opts.retryAfterSec ?? null;
    this.stderr = opts.stderr ?? "";
  }
}

export interface GhClient {
  /** JSON de uma rota REST; com `paginate`, junta as páginas numa lista só. */
  json<T>(path: string, opts?: { paginate?: boolean }): Promise<T>;
  /** Conteúdo cru (README, arquivos), pelo Accept raw. */
  raw(path: string): Promise<string>;
  /** Iguais a `json`/`raw`, mas 404 vira `null`. */
  tryJson<T>(path: string, opts?: { paginate?: boolean }): Promise<T | null>;
  tryRaw(path: string): Promise<string | null>;
  /** Devolve só `data`; `errors` do GraphQL viram `GhError("failed")`. Variáveis vão como strings (`-f`). */
  graphql<T>(query: string, variables?: Record<string, string>): Promise<T>;
}

export interface GhClientOptions {
  exec: GhExec;
  /** Só para mascarar: se aparecer em stderr, vira `***`. Quem passa o token ao processo é o `exec`. */
  token?: string | null;
  now?: () => number;
  /** Espera entre novas tentativas em erros 5xx (injetável nos testes). */
  sleep?: (ms: number) => Promise<void>;
}

/** Erros 5xx do GitHub são transitórios (sobrecarga): até 3 tentativas, esperando 1 s e 2 s (regressão 2026-10-10). */
export const GH_RETRY_DELAYS_MS = [1000, 2000] as const;
const isTransient = (status: number | null) => status !== null && status >= 500 && status <= 599;

const RAW_ACCEPT = "Accept: application/vnd.github.raw";
const TOKEN_PATTERN = /\b(gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g;

export function sanitizeSecrets(text: string, token?: string | null): string {
  let out = text.replace(TOKEN_PATTERN, "***");
  if (token) out = out.split(token).join("***");
  return out;
}

/** Valores JSON concatenados (o `gh api --paginate` imprime uma página atrás da outra, sem separador). */
export function parseJsonStream(text: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      if (depth === 0 && start < 0) start = i;
      continue;
    }
    if (ch === "[" || ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push(JSON.parse(text.slice(start, i + 1)));
        start = -1;
      }
    }
  }
  const rest = start >= 0 ? text.slice(start).trim() : "";
  if (depth !== 0 || rest) throw new GhError("failed", "Resposta JSON incompleta do gh");
  return out;
}

function statusOf(stderr: string): number | null {
  const m = /\(HTTP (\d{3})\)/.exec(stderr);
  return m ? Number(m[1]) : null;
}

export function createGhClient(opts: GhClientOptions): GhClient {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function retryAfter(): Promise<number | null> {
    try {
      const r = await opts.exec(["api", "rate_limit"]);
      if (r.code !== 0) return null;
      const reset = (JSON.parse(r.stdout) as { resources?: { core?: { reset?: number } } })
        .resources?.core?.reset;
      return typeof reset === "number" ? Math.max(0, Math.ceil(reset - now() / 1000)) : null;
    } catch {
      return null;
    }
  }

  async function toError(r: GhExecResult): Promise<GhError> {
    const stderr = sanitizeSecrets(r.stderr.trim(), opts.token);
    const status = statusOf(stderr);
    const lower = stderr.toLowerCase();
    if (status === 401 || /requires authentication|bad credentials|gh auth login/.test(lower)) {
      return new GhError("not_authenticated", `GitHub sem autenticação: ${stderr}`, {
        status: status ?? 401,
        stderr,
      });
    }
    if ((status === 403 || status === 429) && lower.includes("rate limit")) {
      const explicit = /retry after (\d+)/i.exec(stderr);
      return new GhError("rate_limited", `Limite de requisições do GitHub: ${stderr}`, {
        status,
        stderr,
        retryAfterSec: explicit ? Number(explicit[1]) : await retryAfter(),
      });
    }
    if (status === 404)
      return new GhError("not_found", `Não encontrado: ${stderr}`, { status, stderr });
    if (status === 409 && /repository is empty/i.test(stderr))
      return new GhError("empty", "Repositório vazio (sem commits)", { status, stderr });
    if (isTransient(status))
      return new GhError(
        "unavailable",
        `GitHub instável (HTTP ${status}); tente de novo em alguns minutos: ${stderr}`,
        { status, stderr },
      );
    // sem rede: o snapshot pode responder (F03-9); demais falhas seguem como "failed"
    if (
      status === null &&
      /error connecting|dial tcp|no such host|could not resolve|connection refused|network is unreachable|i\/o timeout/i.test(
        stderr,
      )
    ) {
      return new GhError("unavailable", `GitHub inacessível: ${stderr}`, { stderr });
    }
    return new GhError("failed", `Falha no gh: ${stderr || `código ${r.code}`}`, {
      status,
      stderr,
    });
  }

  async function run(args: string[]): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      let r: GhExecResult;
      try {
        r = await opts.exec(args);
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err.code === "ENOENT") throw new GhError("unavailable", "gh não está instalado");
        throw new GhError("failed", sanitizeSecrets(String(err.message ?? e), opts.token));
      }
      if (r.code === 0) return r.stdout;
      const delay = GH_RETRY_DELAYS_MS[attempt];
      if (delay !== undefined && isTransient(statusOf(r.stderr))) {
        await sleep(delay);
        continue;
      }
      throw await toError(r);
    }
  }

  const client: GhClient = {
    async json<T>(path: string, o: { paginate?: boolean } = {}) {
      const out = await run(o.paginate ? ["api", path, "--paginate"] : ["api", path]);
      if (!o.paginate) return JSON.parse(out) as T;
      const pages = parseJsonStream(out);
      return (pages.every(Array.isArray) ? pages.flat() : pages) as T;
    },
    raw(path) {
      return run(["api", path, "-H", RAW_ACCEPT]);
    },
    async tryJson<T>(path: string, o: { paginate?: boolean } = {}) {
      try {
        return await client.json<T>(path, o);
      } catch (e) {
        if (e instanceof GhError && e.code === "not_found") return null;
        throw e;
      }
    },
    async tryRaw(path) {
      try {
        return await client.raw(path);
      } catch (e) {
        if (e instanceof GhError && e.code === "not_found") return null;
        throw e;
      }
    },
    async graphql<T>(query: string, variables: Record<string, string> = {}) {
      const args = ["api", "graphql", "-f", `query=${query}`];
      for (const [k, v] of Object.entries(variables)) args.push("-f", `${k}=${v}`);
      const parsed = JSON.parse(await run(args)) as {
        data?: T | null;
        errors?: { message: string }[];
      };
      if (parsed.errors?.length || parsed.data == null) {
        const msg = parsed.errors?.map((e) => e.message).join("; ") ?? "sem dados";
        throw new GhError("failed", sanitizeSecrets(`GraphQL: ${msg}`, opts.token));
      }
      return parsed.data;
    },
  };
  return client;
}

/**
 * Executor real: `gh` com `GH_TOKEN` só no ambiente do processo filho (origem `host`, F03-1) ou sem ele (login
 * próprio no volume `gh-auth`). Nunca rejeita por código de saída ≠ 0.
 */
export function createDefaultGhExec(o: { token?: string | null; timeoutMs?: number } = {}): GhExec {
  return (args) =>
    new Promise((resolve, reject) => {
      const env: NodeJS.ProcessEnv = { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" };
      if (o.token) env.GH_TOKEN = o.token;
      execFile(
        "gh",
        args,
        { encoding: "utf8", env, timeout: o.timeoutMs ?? 60_000, maxBuffer: 64 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const e = err as (NodeJS.ErrnoException & { code?: unknown }) | null;
          if (e && (e.code === "ENOENT" || e.code === "EACCES")) return reject(e);
          resolve({ stdout, stderr, code: e ? (typeof e.code === "number" ? e.code : 1) : 0 });
        },
      );
    });
}
