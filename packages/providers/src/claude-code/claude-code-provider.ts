import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { promisify } from "node:util";
import {
  type AnalyzeProfilesOutput,
  AnalyzeProfilesOutputSchema,
  type AnalyzeRepoOutput,
  AnalyzeRepoOutputSchema,
  type BuildDigestOutput,
  BuildDigestOutputSchema,
  CHAT_OUTPUT_JSON_SCHEMAS,
  type ChatTitleOutput,
  ChatTitleOutputSchema,
  type CheckProposalsOutput,
  CheckProposalsOutputSchema,
  clip,
  contentTracingEnabled,
  EXTRACTION_JSON_SCHEMAS,
  type ExtractFactsOutput,
  ExtractFactsOutputSchema,
  INGEST_OUTPUT_JSON_SCHEMAS,
  messageAttrs,
  type PickFilesOutput,
  PickFilesOutputSchema,
  type PlanUsage,
  POSTING_OUTPUT_JSON_SCHEMAS,
  type PostingDuplicateOutput,
  PostingDuplicateOutputSchema,
  type PostingExtractOutput,
  PostingExtractOutputSchema,
  type PostingMergeOutput,
  PostingMergeOutputSchema,
  type ReadDocumentOutput,
  ReadDocumentOutputSchema,
  type SynthesizeRunOutput,
  SynthesizeRunOutputSchema,
  toJsonSchema,
  withSpan,
} from "@narnia-jobs/shared";
import type { z } from "zod";
import { reportActivity } from "../activity";
import {
  type ChatEvent,
  type ChatHandle,
  type ChatOpenOptions,
  type ChatQueryFn,
  type ChatQueryLike,
  type ChatSdkOptions,
  chatCanUseTool,
  createAsyncQueue,
  normalizeSdkChatMessage,
  type SdkUserMessageLike,
} from "../chat";
import {
  type AnalyzeProfilesProviderInput,
  type AnalyzeRepoInput,
  type AuthMethod,
  type BuildDigestInput,
  type ChatTitleInput,
  type CheckProposalsInput,
  type CompleteInput,
  type CompleteResult,
  type ExtractFactsInput,
  LOGIN_EXPIRED_HINT,
  LOGIN_HINT,
  type PickFilesInput,
  type PostingDuplicateInput,
  type PostingExtractInput,
  type PostingMergeInput,
  type Provider,
  ProviderError,
  type ProviderResult,
  type ProviderStatus,
  type ReadDocumentInput,
  type SdkResultLike,
  type SynthesizeRunInput,
  type Usage,
} from "../provider";
import { resolveClaudeBinary } from "./binary";
import {
  createSdkUsageProbe,
  mapSdkUsageResponse,
  planUsageFromRateLimits,
  type RateLimitInfoLike,
  type UsageProbe,
} from "./plan-usage";
import { PROMPTS } from "./prompt-files";
import { renderStructuredPrompt } from "./prompt-specs";

/* ---------- processos (detect) ---------- */

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}
export type Exec = (cmd: string, args: string[]) => Promise<ExecResult>;

const execFileAsync = promisify(execFile);

/** execFile que não rejeita por exit code ≠ 0 (o `claude auth status` sai com 1 quando não logado). */
export const defaultExec: Exec = async (cmd, args) => {
  try {
    const r = await execFileAsync(cmd, args, { encoding: "utf8", timeout: 20_000 });
    return { stdout: r.stdout, stderr: r.stderr, code: 0 };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: unknown };
    if (err.code === "ENOENT" || err.code === "EACCES") throw err;
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      code: typeof err.code === "number" ? err.code : 1,
    };
  }
};

/** Saída estruturada na ponte: a tool interna do SDK pode pedir uma nova tentativa. */
const COMPLETE_STRUCTURED_MAX_TURNS = 3;

/* ---------- SDK (query) ---------- */

/** Subconjunto estrutural das mensagens do Agent SDK que usamos (evita acoplar os testes aos tipos completos). */
export interface SdkMessageLike {
  type: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  usage?: SdkResultLike["usage"];
  total_cost_usd?: number;
  /** `rate_limit_event` (F03 §2.4): janela do plano com utilização e renovação. */
  rate_limit_info?: RateLimitInfoLike;
  /** `stream_event` (fragmentos, com `includePartialMessages`). */
  event?: { type?: string; delta?: { type?: string; text?: string } };
  /** `assistant`: modelo exato que respondeu. */
  message?: { model?: string };
}

export interface SdkQueryOptions {
  model: string;
  /** Fragmentos parciais no stream (usado só como batimento por job, plano de comunicação C3). */
  includePartialMessages?: boolean;
  tools: string[];
  allowedTools?: string[];
  maxTurns: number;
  systemPrompt: string;
  /** Ausente = texto livre (só a ponte da assinatura usa assim). */
  outputFormat?: { type: "json_schema"; schema: Record<string, unknown> };
  cwd?: string;
  pathToClaudeCodeExecutable?: string;
  settingSources?: Array<"user" | "project" | "local">;
}

export type QueryFn = (params: {
  prompt: string;
  options: SdkQueryOptions;
}) => AsyncIterable<SdkMessageLike>;

export interface ClaudeCodeProviderOptions {
  exec?: Exec;
  query?: QueryFn;
  /** Caminho do CLI; por padrão resolvido por `resolveClaudeBinary`. */
  binaryPath?: string;
  /** Sonda do `/usage` estruturado (F03 §2.4); padrão = sessão do SDK sem mensagem. */
  usageProbe?: UsageProbe;
  /** `query` do SDK para o chat com entrada em streaming (F04 M3); injetável nos testes. */
  chatQuery?: ChatQueryFn;
  /** Conteúdo de `.credentials.json` do CLI (null = ausente); padrão = arquivo em CLAUDE_CONFIG_DIR ou ~/.claude. */
  readCredentials?: () => string | null;
}

export const defaultReadCredentials = (): string | null => {
  const dir = process.env.CLAUDE_CONFIG_DIR || `${homedir()}/.claude`;
  try {
    return readFileSync(`${dir}/.credentials.json`, "utf8");
  } catch {
    return null;
  }
};

/**
 * Credencial do volume esvaziada: sem refreshToken e com o acesso vencido. É o que o CLI grava quando a renovação
 * falha (visto na instância do dono em 2026-10-12); o `claude auth status` segue dizendo "logado".
 */
export function credentialsExpired(raw: string | null, now = Date.now()): boolean {
  if (!raw) return false;
  try {
    const o = (
      JSON.parse(raw) as { claudeAiOauth?: { refreshToken?: unknown; expiresAt?: unknown } }
    ).claudeAiOauth;
    if (!o || typeof o.expiresAt !== "number") return false;
    return !o.refreshToken && o.expiresAt <= now;
  } catch {
    return false;
  }
}

const AUTH_METHODS: ReadonlySet<string> = new Set([
  "none",
  "claude.ai",
  "oauth_token",
  "api_key",
  "api_key_helper",
  "third_party",
]);

/** JSON Schema da análise de perfis (F02), gerado uma vez por processo (sem `$schema`, fix e06eeda). */
export const ANALYZE_PROFILES_JSON_SCHEMA = toJsonSchema(AnalyzeProfilesOutputSchema);

async function defaultQuery(params: {
  prompt: string;
  options: SdkQueryOptions;
}): Promise<AsyncIterable<SdkMessageLike>> {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  type SdkOptions = NonNullable<Parameters<typeof sdk.query>[0]["options"]>;
  return sdk.query({
    prompt: params.prompt,
    options: params.options as unknown as SdkOptions,
  }) as unknown as AsyncIterable<SdkMessageLike>;
}

async function defaultChatQuery(): Promise<ChatQueryFn> {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  type SdkParams = Parameters<typeof sdk.query>[0];
  return ({ prompt, options }) =>
    sdk.query({
      prompt: prompt as unknown as SdkParams["prompt"],
      options: options as unknown as NonNullable<SdkParams["options"]>,
    }) as unknown as ChatQueryLike;
}

function extractJson(text: string): unknown | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf("{");
    const end = c.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1));
    } catch {
      // tenta o próximo candidato
    }
  }
  return undefined;
}

function toUsage(result: SdkMessageLike, model: string): Usage {
  const u = result.usage ?? {};
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    model,
  };
}

/** Provider real (F01 §2.4): `detect` via `claude auth status`; extração via `query()` do Agent SDK com saída estruturada. */
/**
 * Turnos das chamadas de saída estruturada (sem tools). Com 1 turno, quando a primeira resposta não passa no schema o
 * CLI não consegue corrigir e falha com "Reached maximum number of turns (1)" (visto na instância do dono em
 * 2026-10-11 numa análise de repositório). Sem tools, turnos além do primeiro só existem nessa correção.
 */
export const STRUCTURED_MAX_TURNS = 3;

/** Turnos da leitura de documento (leitura 3): até ~5 chamadas ao Read (100 páginas) + a saída estruturada. */
const READ_DOCUMENT_MAX_TURNS = 6;

/** Nome do servidor MCP no chat (mesmo do plugin: as tools viram `mcp__narnia-jobs__<nome>`). */
const CHAT_MCP_SERVER = "narnia-jobs";

export class ClaudeCodeProvider implements Provider {
  readonly id = "claude-code" as const;
  private readonly exec: Exec;
  private readonly query: QueryFn | null;
  private readonly chatQuery: ChatQueryFn | null;
  private readonly binaryPath: string | null;
  private readonly usageProbe: UsageProbe;
  private readonly readCredentials: () => string | null;
  /** Último `rate_limit_event` por tipo de janela, visto em qualquer `query` deste processo. */
  private readonly rateLimits = new Map<string, RateLimitInfoLike>();

  constructor(options: ClaudeCodeProviderOptions = {}) {
    this.exec = options.exec ?? defaultExec;
    this.query = options.query ?? null;
    this.chatQuery = options.chatQuery ?? null;
    this.binaryPath =
      options.binaryPath ??
      resolveClaudeBinary({ explicit: process.env.CLAUDE_CODE_BIN || undefined });
    this.usageProbe = options.usageProbe ?? createSdkUsageProbe({ binaryPath: this.binaryPath });
    this.readCredentials = options.readCredentials ?? defaultReadCredentials;
  }

  /**
   * Sessão longa de chat (F04 M3): `query` do SDK com entrada em streaming; cada `send` vira uma mensagem do usuário.
   * Falhas ao abrir ou durante o stream viram evento `error` (nunca lançam para quem consome).
   */
  openChat(opts: ChatOpenOptions): ChatHandle {
    const input = createAsyncQueue<SdkUserMessageLike>();
    let model = opts.model;
    let providerSessionId = opts.resume ?? null;
    const options: ChatSdkOptions = {
      model,
      systemPrompt: { type: "custom", prompt: opts.systemPrompt, snapshot: false },
      maxTurns: opts.maxTurns,
      includePartialMessages: true,
      // subagentes (F06-8): a tool Agent só existe quando há subagente declarado, e passa pelo canUseTool
      tools: opts.agents ? [...opts.tools, "Agent"] : opts.tools,
      // o chat roda sem terminal: tool sem permissão explícita é negada (dono, 2026-10-12). O /mcp já limita as tools
      // pela categoria da sessão. WebFetch fica fora: o canUseTool só libera domínio confiável (auditoria A)
      allowedTools: [`mcp__${CHAT_MCP_SERVER}`, ...opts.tools.filter((t) => t !== "WebFetch")],
      canUseTool: chatCanUseTool(opts.canFetch, Object.keys(opts.agents ?? {})),
      verbatimPrompts: true,
      plugins: opts.pluginDir
        ? [{ type: "local", path: opts.pluginDir, skipMcpDiscovery: true }]
        : [],
      mcpServers: {
        [CHAT_MCP_SERVER]: {
          type: "http",
          url: opts.mcp.url,
          headers: opts.mcp.headers,
          alwaysLoad: true,
        },
      },
      // o env do SDK substitui o do processo: herda tudo (PATH, HOME, token) e acrescenta o da sessão
      // sem tarefas em segundo plano (F06-8): o subagente roda dentro do turno, que só fecha com a análise pronta
      env: { ...process.env, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1", ...(opts.env ?? {}) },
      settingSources: [],
      ...(opts.resume ? { resume: opts.resume } : {}),
      ...(typeof opts.maxBudgetUsd === "number" ? { maxBudgetUsd: opts.maxBudgetUsd } : {}),
      ...(this.binaryPath ? { pathToClaudeCodeExecutable: this.binaryPath } : {}),
      ...(opts.agents ? { agents: opts.agents } : {}),
    };
    const ready: Promise<ChatQueryLike> = (async () => {
      const fn = this.chatQuery ?? (await defaultChatQuery());
      return fn({ prompt: input.iterable, options });
    })();
    ready.catch(() => undefined);
    const rateLimits = this.rateLimits;
    async function* events(): AsyncGenerator<ChatEvent> {
      let q: ChatQueryLike;
      try {
        q = await ready;
      } catch (e) {
        yield { type: "error", message: `Falha ao abrir o chat: ${(e as Error).message}` };
        return;
      }
      try {
        for await (const m of q) {
          const info = (m as { rate_limit_info?: RateLimitInfoLike }).rate_limit_info;
          if (m.type === "rate_limit_event" && info)
            rateLimits.set(info.rateLimitType ?? "five_hour", info);
          for (const e of normalizeSdkChatMessage(m, model)) {
            if (e.type === "init") providerSessionId = e.providerSessionId;
            yield e;
          }
        }
      } catch (e) {
        yield { type: "error", message: `Falha no chat: ${(e as Error).message}` };
      }
    }
    return {
      send(text) {
        input.push({
          type: "user",
          message: { role: "user", content: text },
          parent_tool_use_id: null,
          session_id: providerSessionId ?? "",
        });
      },
      events: events(),
      async interrupt() {
        const q = await ready.catch(() => null);
        await q?.interrupt();
      },
      async setModel(next) {
        model = next;
        const q = await ready.catch(() => null);
        await q?.setModel(next);
      },
      close() {
        input.end();
        void ready.then((q) => q.close?.()).catch(() => undefined);
      },
    };
  }

  /** Diagnóstico do plano: API experimental primeiro, depois o último evento de limite; `null` sem dado. */
  async getPlanUsage(): Promise<PlanUsage | null> {
    try {
      const fromApi = mapSdkUsageResponse(await this.usageProbe());
      if (fromApi) return fromApi;
    } catch {
      // API experimental indisponível: segue para o evento
    }
    return planUsageFromRateLimits(this.rateLimits);
  }

  planWindowSnapshot(): { utilization: number | null; resetsAt: string | null } | null {
    const w = planUsageFromRateLimits(this.rateLimits)?.windows.fiveHour;
    return w ? { utilization: w.utilization, resetsAt: w.resetsAt } : null;
  }

  async detect(): Promise<ProviderStatus> {
    const notInstalled: ProviderStatus = {
      installed: false,
      loggedIn: false,
      authMethod: "none",
      version: null,
      loginHint: LOGIN_HINT,
    };
    if (!this.binaryPath) return notInstalled;
    let version: string | null = null;
    try {
      const v = await this.exec(this.binaryPath, ["--version"]);
      version = /(\d+\.\d+\.\d+)/.exec(v.stdout)?.[1] ?? null;
    } catch {
      return notInstalled;
    }
    let loggedIn = false;
    let authMethod: AuthMethod = "none";
    try {
      const s = await this.exec(this.binaryPath, ["auth", "status"]);
      const parsed = JSON.parse(s.stdout) as { loggedIn?: boolean; authMethod?: string };
      loggedIn = s.code === 0 && parsed.loggedIn === true;
      const method = parsed.authMethod ?? "none";
      authMethod = loggedIn && AUTH_METHODS.has(method) ? (method as AuthMethod) : "none";
    } catch {
      loggedIn = false;
    }
    // o token do .env (oauth_token) não usa o arquivo; o login do volume pode estar esvaziado mesmo "logado"
    if (loggedIn && authMethod === "claude.ai" && credentialsExpired(this.readCredentials())) {
      return {
        installed: true,
        loggedIn: false,
        authMethod: "none",
        version,
        loginHint: LOGIN_EXPIRED_HINT,
        authExpired: true,
      };
    }
    return {
      installed: true,
      loggedIn,
      authMethod,
      version,
      loginHint: loggedIn ? null : LOGIN_HINT,
    };
  }

  /** Chamada estruturada com span LLM (F04/M5): modelo, tokens e custo; prompt e saída só com NARNIA_OTEL_CONTENT=1. */
  private run<T>(
    prompt: string,
    options: Omit<SdkQueryOptions, "pathToClaudeCodeExecutable" | "settingSources">,
    schema: z.ZodType<T>,
    operation: string,
  ): Promise<ProviderResult<T>> {
    const content = contentTracingEnabled();
    return withSpan(
      "llm.structured",
      {
        "openinference.span.kind": "LLM",
        "llm.provider": "anthropic",
        "llm.system": "anthropic",
        "llm.model_name": options.model ?? "",
        "narnia.operation": operation,
        ...(content
          ? {
              ...messageAttrs("llm.input_messages", [
                { role: "system", content: options.systemPrompt },
                { role: "user", content: prompt },
              ]),
              "input.value": clip(prompt),
              "input.mime_type": "text/plain",
            }
          : {}),
      },
      async (span) => {
        const r = await this.runRaw(prompt, options, schema);
        const promptTokens =
          r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens;
        const out = content ? clip(JSON.stringify(r.output)) : "";
        span.setAttributes({
          "llm.token_count.prompt": promptTokens,
          "llm.token_count.prompt_details.cache_read": r.usage.cacheReadTokens,
          "llm.token_count.prompt_details.cache_write": r.usage.cacheWriteTokens,
          "llm.token_count.completion": r.usage.outputTokens,
          "llm.token_count.total": promptTokens + r.usage.outputTokens,
          "narnia.cost_usd": r.costUsd,
          ...(content
            ? {
                ...messageAttrs("llm.output_messages", [{ role: "assistant", content: out }]),
                "output.value": out,
                "output.mime_type": "application/json",
              }
            : {}),
        });
        return r;
      },
    );
  }

  private async runRaw<T>(
    prompt: string,
    options: Omit<SdkQueryOptions, "pathToClaudeCodeExecutable" | "settingSources">,
    schema: z.ZodType<T>,
  ): Promise<ProviderResult<T>> {
    const fullOptions: SdkQueryOptions = {
      ...options,
      // fragmentos parciais só como sinal de vida (CM-6); o texto não sai daqui
      includePartialMessages: true,
      settingSources: [],
      ...(this.binaryPath ? { pathToClaudeCodeExecutable: this.binaryPath } : {}),
    };
    let result: SdkMessageLike | null = null;
    try {
      const stream = this.query
        ? this.query({ prompt, options: fullOptions })
        : await defaultQuery({ prompt, options: fullOptions });
      for await (const message of stream) {
        reportActivity();
        if (message.type === "result") result = message;
        if (message.type === "rate_limit_event" && message.rate_limit_info) {
          const info = message.rate_limit_info;
          this.rateLimits.set(info.rateLimitType ?? "five_hour", info);
        }
      }
    } catch (e) {
      throw new ProviderError(
        "query_failed",
        `Falha ao consultar o modelo: ${(e as Error).message}`,
        e,
      );
    }
    if (!result) throw new ProviderError("query_failed", "O modelo não devolveu resultado");
    let raw = result.structured_output;
    if (raw === undefined && result.result) raw = extractJson(result.result);
    if (raw === undefined) {
      const code =
        result.subtype === "error_max_structured_output_retries" || result.is_error
          ? "structured_output_failed"
          : "invalid_output";
      throw new ProviderError(
        code,
        `Sem saída estruturada (${result.subtype ?? "sem subtipo"}): ${result.result ?? ""}`.trim(),
      );
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new ProviderError(
        "invalid_output",
        `Saída fora do schema: ${parsed.error.message}`,
        parsed.error,
      );
    }
    return {
      output: parsed.data,
      usage: toUsage(result, options.model),
      costUsd: result.total_cost_usd ?? 0,
      sdk: { usage: result.usage ?? {}, total_cost_usd: result.total_cost_usd ?? 0 },
    };
  }

  /**
   * Ponte da assinatura (avaliações no Phoenix, M1): uma resposta do modelo, sem tools e sem configurações do
   * usuário; com schema, a saída estruturada do SDK (o JSON vira o texto da resposta). Erro do modelo vira
   * `ProviderError` com a mensagem dele.
   */
  complete(input: CompleteInput, onText?: (text: string) => void): Promise<CompleteResult> {
    // toda chamada ao modelo deixa o gasto no Phoenix (2026-10-13), inclusive a da ponte e a das avaliações
    const content = contentTracingEnabled();
    return withSpan(
      "llm.complete",
      {
        "openinference.span.kind": "LLM",
        "llm.provider": "anthropic",
        "llm.system": "anthropic",
        "llm.model_name": input.model,
        "narnia.operation": "complete",
        ...(content
          ? {
              ...messageAttrs("llm.input_messages", [
                { role: "system", content: input.system },
                { role: "user", content: input.prompt },
              ]),
              "input.value": clip(input.prompt),
              "input.mime_type": "text/plain",
            }
          : {}),
      },
      async (span) => {
        const r = await this.completeRaw(input, onText);
        const promptTokens =
          r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens;
        span.setAttributes({
          "llm.model_name": r.model,
          "llm.token_count.prompt": promptTokens,
          "llm.token_count.prompt_details.cache_read": r.usage.cacheReadTokens,
          "llm.token_count.prompt_details.cache_write": r.usage.cacheWriteTokens,
          "llm.token_count.completion": r.usage.outputTokens,
          "llm.token_count.total": promptTokens + r.usage.outputTokens,
          "narnia.cost_usd": r.costUsd,
          ...(content
            ? {
                ...messageAttrs("llm.output_messages", [
                  { role: "assistant", content: clip(r.text) },
                ]),
                "output.value": clip(r.text),
                "output.mime_type": "text/plain",
              }
            : {}),
        });
        return r;
      },
    );
  }

  private async completeRaw(
    input: CompleteInput,
    onText?: (text: string) => void,
  ): Promise<CompleteResult> {
    const options: SdkQueryOptions = {
      model: input.model,
      tools: [],
      // a saída estruturada usa uma tool interna do SDK: pede mais de um turno
      maxTurns: input.jsonSchema ? COMPLETE_STRUCTURED_MAX_TURNS : 1,
      systemPrompt: input.system,
      includePartialMessages: true,
      settingSources: [],
      ...(input.jsonSchema
        ? { outputFormat: { type: "json_schema", schema: input.jsonSchema } }
        : {}),
      ...(this.binaryPath ? { pathToClaudeCodeExecutable: this.binaryPath } : {}),
    };
    let result: SdkMessageLike | null = null;
    let model = input.model;
    try {
      const stream = this.query
        ? this.query({ prompt: input.prompt, options })
        : await defaultQuery({ prompt: input.prompt, options });
      for await (const m of stream) {
        reportActivity();
        if (m.type === "stream_event") {
          const d = m.event?.delta;
          if (m.event?.type === "content_block_delta" && d?.type === "text_delta" && d.text)
            onText?.(d.text);
        } else if (m.type === "assistant" && m.message?.model) model = m.message.model;
        else if (m.type === "result") result = m;
      }
    } catch (e) {
      throw new ProviderError(
        "query_failed",
        `Falha ao consultar o modelo: ${(e as Error).message}`,
        e,
      );
    }
    if (!result) throw new ProviderError("query_failed", "O modelo não devolveu resultado");
    if (result.is_error || result.subtype !== "success")
      throw new ProviderError(
        "query_failed",
        result.result || `Falha do modelo (${result.subtype ?? "sem subtipo"})`,
      );
    const structured = input.jsonSchema
      ? (result.structured_output ?? extractJson(result.result ?? "") ?? null)
      : null;
    return {
      text: structured !== null ? JSON.stringify(structured) : (result.result ?? ""),
      structured,
      model,
      usage: toUsage(result, model),
      costUsd: result.total_cost_usd ?? 0,
    };
  }

  async readDocument(input: ReadDocumentInput): Promise<ProviderResult<ReadDocumentOutput>> {
    const dir = dirname(input.filePath);
    const prompt = renderStructuredPrompt("readDocument", input);
    return this.run(
      prompt,
      {
        model: input.model,
        tools: ["Read"],
        allowedTools: ["Read"],
        // o Read lê no máximo 20 páginas por chamada: PDF longo pede várias leituras + a saída estruturada
        maxTurns: READ_DOCUMENT_MAX_TURNS,
        cwd: dir,
        systemPrompt: PROMPTS.readDocument(),
        outputFormat: { type: "json_schema", schema: EXTRACTION_JSON_SCHEMAS.readDocument },
      },
      ReadDocumentOutputSchema,
      "readDocument",
    );
  }

  async extractFacts(input: ExtractFactsInput): Promise<ProviderResult<ExtractFactsOutput>> {
    const prompt = renderStructuredPrompt("extractFacts", input);
    return this.run(
      prompt,
      {
        model: input.model,
        tools: [],
        maxTurns: STRUCTURED_MAX_TURNS,
        systemPrompt: PROMPTS.extractFacts(),
        outputFormat: { type: "json_schema", schema: EXTRACTION_JSON_SCHEMAS.extractFacts },
      },
      ExtractFactsOutputSchema,
      "extractFacts",
    );
  }

  async analyzeProfiles(
    input: AnalyzeProfilesProviderInput,
  ): Promise<ProviderResult<AnalyzeProfilesOutput>> {
    const { model } = input;
    const prompt = renderStructuredPrompt("analyzeProfiles", input);
    return this.run(
      prompt,
      {
        model,
        tools: [],
        maxTurns: STRUCTURED_MAX_TURNS,
        systemPrompt: PROMPTS.analyzeProfiles(),
        outputFormat: { type: "json_schema", schema: ANALYZE_PROFILES_JSON_SCHEMA },
      },
      AnalyzeProfilesOutputSchema,
      "analyzeProfiles",
    );
  }

  /** Chamada sem tools com saída estruturada (F03 §2.5); turnos extras só são gastos se o JSON precisar de correção. */
  private single<T>(
    prompt: string,
    model: string,
    systemPrompt: string,
    schema: Record<string, unknown>,
    zod: z.ZodType<T>,
    operation: string,
  ): Promise<ProviderResult<T>> {
    return this.run(
      prompt,
      {
        model,
        tools: [],
        maxTurns: STRUCTURED_MAX_TURNS,
        systemPrompt,
        outputFormat: { type: "json_schema", schema },
      },
      zod,
      operation,
    );
  }

  pickFiles(input: PickFilesInput): Promise<ProviderResult<PickFilesOutput>> {
    const prompt = renderStructuredPrompt("pickFiles", input);
    return this.single(
      prompt,
      input.model,
      PROMPTS.pickFiles(),
      INGEST_OUTPUT_JSON_SCHEMAS.pickFiles,
      PickFilesOutputSchema,
      "pickFiles",
    );
  }

  analyzeRepo(input: AnalyzeRepoInput): Promise<ProviderResult<AnalyzeRepoOutput>> {
    const prompt = renderStructuredPrompt("analyzeRepo", input);
    return this.single(
      prompt,
      input.model,
      PROMPTS.analyzeRepo(),
      INGEST_OUTPUT_JSON_SCHEMAS.analyzeRepo,
      AnalyzeRepoOutputSchema,
      "analyzeRepo",
    );
  }

  synthesizeRun(input: SynthesizeRunInput): Promise<ProviderResult<SynthesizeRunOutput>> {
    const prompt = renderStructuredPrompt("synthesizeRun", input);
    return this.single(
      prompt,
      input.model,
      PROMPTS.synthesizeRun(),
      INGEST_OUTPUT_JSON_SCHEMAS.synthesizeRun,
      SynthesizeRunOutputSchema,
      "synthesizeRun",
    );
  }

  checkProposals(input: CheckProposalsInput): Promise<ProviderResult<CheckProposalsOutput>> {
    const prompt = renderStructuredPrompt("checkProposals", input);
    return this.single(
      prompt,
      input.model,
      PROMPTS.checkProposals(),
      INGEST_OUTPUT_JSON_SCHEMAS.checkProposals,
      CheckProposalsOutputSchema,
      "checkProposals",
    );
  }

  chatTitle(input: ChatTitleInput): Promise<ProviderResult<ChatTitleOutput>> {
    const prompt = renderStructuredPrompt("chatTitle", input);
    return this.single(
      prompt,
      input.model,
      PROMPTS.chatTitle(),
      CHAT_OUTPUT_JSON_SCHEMAS.chatTitle,
      ChatTitleOutputSchema,
      "chatTitle",
    );
  }

  postingExtract(input: PostingExtractInput): Promise<ProviderResult<PostingExtractOutput>> {
    return this.single(
      renderStructuredPrompt("postingExtract", input),
      input.model,
      PROMPTS.postingExtract(),
      POSTING_OUTPUT_JSON_SCHEMAS.postingExtract,
      PostingExtractOutputSchema,
      "postingExtract",
    );
  }

  postingMerge(input: PostingMergeInput): Promise<ProviderResult<PostingMergeOutput>> {
    return this.single(
      renderStructuredPrompt("postingMerge", input),
      input.model,
      PROMPTS.postingMerge(),
      POSTING_OUTPUT_JSON_SCHEMAS.postingMerge,
      PostingMergeOutputSchema,
      "postingMerge",
    );
  }

  postingDuplicate(input: PostingDuplicateInput): Promise<ProviderResult<PostingDuplicateOutput>> {
    return this.single(
      renderStructuredPrompt("postingDuplicate", input),
      input.model,
      PROMPTS.postingDuplicate(),
      POSTING_OUTPUT_JSON_SCHEMAS.postingDuplicate,
      PostingDuplicateOutputSchema,
      "postingDuplicate",
    );
  }

  async buildDigest(input: BuildDigestInput): Promise<ProviderResult<BuildDigestOutput>> {
    const prompt = renderStructuredPrompt("buildDigest", input);
    return this.run(
      prompt,
      {
        model: input.model,
        tools: [],
        maxTurns: STRUCTURED_MAX_TURNS,
        systemPrompt: PROMPTS.buildDigest(),
        outputFormat: { type: "json_schema", schema: EXTRACTION_JSON_SCHEMAS.buildDigest },
      },
      BuildDigestOutputSchema,
      "buildDigest",
    );
  }
}
