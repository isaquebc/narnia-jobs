import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { promisify } from "node:util";
import {
  type AnalyzeProfilesOutput,
  AnalyzeProfilesOutputSchema,
  type AnalyzeRepoOutput,
  AnalyzeRepoOutputSchema,
  type BuildDigestOutput,
  BuildDigestOutputSchema,
  type CheckProposalsOutput,
  CheckProposalsOutputSchema,
  EXTRACTION_JSON_SCHEMAS,
  type ExtractFactsOutput,
  ExtractFactsOutputSchema,
  INGEST_OUTPUT_JSON_SCHEMAS,
  type PickFilesOutput,
  PickFilesOutputSchema,
  type PlanUsage,
  type ReadDocumentOutput,
  ReadDocumentOutputSchema,
  type SynthesizeRunOutput,
  SynthesizeRunOutputSchema,
  toJsonSchema,
} from "@narnia-jobs/shared";
import type { z } from "zod";
import {
  type AnalyzeProfilesProviderInput,
  type AnalyzeRepoInput,
  type AuthMethod,
  type BuildDigestInput,
  type CheckProposalsInput,
  type ExtractFactsInput,
  LOGIN_HINT,
  type PickFilesInput,
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
}

export interface SdkQueryOptions {
  model: string;
  tools: string[];
  allowedTools?: string[];
  maxTurns: number;
  systemPrompt: string;
  outputFormat: { type: "json_schema"; schema: Record<string, unknown> };
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
}

const AUTH_METHODS: ReadonlySet<string> = new Set([
  "none",
  "claude.ai",
  "oauth_token",
  "api_key",
  "api_key_helper",
  "third_party",
]);

const PROMPTS_DIR = new URL("./prompts/", import.meta.url);
function loadPrompt(name: string): string {
  return readFileSync(new URL(`${name}.md`, PROMPTS_DIR), "utf8").trim();
}
/** Prompts em Markdown, lidos uma vez por processo (pacotes exportam fonte TS, decisão F01-28). */
export const PROMPTS = {
  readDocument: () => loadPrompt("read-document"),
  extractFacts: () => loadPrompt("extract-facts"),
  buildDigest: () => loadPrompt("build-digest"),
  analyzeProfiles: () => loadPrompt("analyze-profiles"),
  pickFiles: () => loadPrompt("pick-files"),
  analyzeRepo: () => loadPrompt("analyze-repo"),
  synthesizeRun: () => loadPrompt("synthesize-run"),
  checkProposals: () => loadPrompt("check-proposals"),
};

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
export class ClaudeCodeProvider implements Provider {
  readonly id = "claude-code" as const;
  private readonly exec: Exec;
  private readonly query: QueryFn | null;
  private readonly binaryPath: string | null;
  private readonly usageProbe: UsageProbe;
  /** Último `rate_limit_event` por tipo de janela, visto em qualquer `query` deste processo. */
  private readonly rateLimits = new Map<string, RateLimitInfoLike>();

  constructor(options: ClaudeCodeProviderOptions = {}) {
    this.exec = options.exec ?? defaultExec;
    this.query = options.query ?? null;
    this.binaryPath =
      options.binaryPath ??
      resolveClaudeBinary({ explicit: process.env.CLAUDE_CODE_BIN || undefined });
    this.usageProbe = options.usageProbe ?? createSdkUsageProbe({ binaryPath: this.binaryPath });
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
    return {
      installed: true,
      loggedIn,
      authMethod,
      version,
      loginHint: loggedIn ? null : LOGIN_HINT,
    };
  }

  private async run<T>(
    prompt: string,
    options: Omit<SdkQueryOptions, "pathToClaudeCodeExecutable" | "settingSources">,
    schema: z.ZodType<T>,
  ): Promise<ProviderResult<T>> {
    const fullOptions: SdkQueryOptions = {
      ...options,
      settingSources: [],
      ...(this.binaryPath ? { pathToClaudeCodeExecutable: this.binaryPath } : {}),
    };
    let result: SdkMessageLike | null = null;
    try {
      const stream = this.query
        ? this.query({ prompt, options: fullOptions })
        : await defaultQuery({ prompt, options: fullOptions });
      for await (const message of stream) {
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

  async readDocument(input: ReadDocumentInput): Promise<ProviderResult<ReadDocumentOutput>> {
    const dir = dirname(input.filePath);
    const name = basename(input.filePath);
    const prompt = `Leia o arquivo "${name}" (nesta pasta) com a ferramenta Read e transcreva todo o texto conforme as instruções. Idioma esperado: ${input.locale}.`;
    return this.run(
      prompt,
      {
        model: input.model,
        tools: ["Read"],
        allowedTools: ["Read"],
        maxTurns: 3,
        cwd: dir,
        systemPrompt: PROMPTS.readDocument(),
        outputFormat: { type: "json_schema", schema: EXTRACTION_JSON_SCHEMAS.readDocument },
      },
      ReadDocumentOutputSchema,
    );
  }

  async extractFacts(input: ExtractFactsInput): Promise<ProviderResult<ExtractFactsOutput>> {
    const prompt = `Idioma do documento: ${input.locale}.\n\n<documento>\n${input.text}\n</documento>`;
    return this.run(
      prompt,
      {
        model: input.model,
        tools: [],
        maxTurns: 1,
        systemPrompt: PROMPTS.extractFacts(),
        outputFormat: { type: "json_schema", schema: EXTRACTION_JSON_SCHEMAS.extractFacts },
      },
      ExtractFactsOutputSchema,
    );
  }

  async analyzeProfiles(
    input: AnalyzeProfilesProviderInput,
  ): Promise<ProviderResult<AnalyzeProfilesOutput>> {
    const { model, ...history } = input;
    const prompt = `<historico>\n${JSON.stringify(history, null, 1)}\n</historico>`;
    return this.run(
      prompt,
      {
        model,
        tools: [],
        maxTurns: 1,
        systemPrompt: PROMPTS.analyzeProfiles(),
        outputFormat: { type: "json_schema", schema: ANALYZE_PROFILES_JSON_SCHEMA },
      },
      AnalyzeProfilesOutputSchema,
    );
  }

  /** Chamada sem tools e de um turno com saída estruturada (F03 §2.5). */
  private single<T>(
    prompt: string,
    model: string,
    systemPrompt: string,
    schema: Record<string, unknown>,
    zod: z.ZodType<T>,
  ): Promise<ProviderResult<T>> {
    return this.run(
      prompt,
      {
        model,
        tools: [],
        maxTurns: 1,
        systemPrompt,
        outputFormat: { type: "json_schema", schema },
      },
      zod,
    );
  }

  pickFiles(input: PickFilesInput): Promise<ProviderResult<PickFilesOutput>> {
    const prompt = [
      `Repositório: ${input.repo}. Escolha no máximo ${input.maxFiles} arquivos (maxFiles = ${input.maxFiles}).`,
      `<candidatos>\n${input.candidates.join("\n")}\n</candidatos>`,
      `<arvore>\n${input.tree.join("\n")}\n</arvore>`,
    ].join("\n\n");
    return this.single(
      prompt,
      input.model,
      PROMPTS.pickFiles(),
      INGEST_OUTPUT_JSON_SCHEMAS.pickFiles,
      PickFilesOutputSchema,
    );
  }

  analyzeRepo(input: AnalyzeRepoInput): Promise<ProviderResult<AnalyzeRepoOutput>> {
    const prompt = `Repositório: ${input.repo}.\n\n<contexto>\n${input.context}\n</contexto>`;
    return this.single(
      prompt,
      input.model,
      PROMPTS.analyzeRepo(),
      INGEST_OUTPUT_JSON_SCHEMAS.analyzeRepo,
      AnalyzeRepoOutputSchema,
    );
  }

  synthesizeRun(input: SynthesizeRunInput): Promise<ProviderResult<SynthesizeRunOutput>> {
    const reports = input.reports
      .map((r) => `## ${r.fullName}\n${JSON.stringify(r.report, null, 1)}`)
      .join("\n\n");
    const prompt = `<relatorios>\n${reports}\n</relatorios>\n\n<metricas>\n${input.metricsTable}\n</metricas>`;
    return this.single(
      prompt,
      input.model,
      PROMPTS.synthesizeRun(),
      INGEST_OUTPUT_JSON_SCHEMAS.synthesizeRun,
      SynthesizeRunOutputSchema,
    );
  }

  checkProposals(input: CheckProposalsInput): Promise<ProviderResult<CheckProposalsOutput>> {
    const prompt = `<itens>\n${JSON.stringify(input.items, null, 1)}\n</itens>`;
    return this.single(
      prompt,
      input.model,
      PROMPTS.checkProposals(),
      INGEST_OUTPUT_JSON_SCHEMAS.checkProposals,
      CheckProposalsOutputSchema,
    );
  }

  async buildDigest(input: BuildDigestInput): Promise<ProviderResult<BuildDigestOutput>> {
    const prompt = `Idioma do documento: ${input.locale}.\n\n<documento>\n${input.text}\n</documento>\n\n<fatos_extraidos>\n${JSON.stringify(input.proposals)}\n</fatos_extraidos>`;
    return this.run(
      prompt,
      {
        model: input.model,
        tools: [],
        maxTurns: 1,
        systemPrompt: PROMPTS.buildDigest(),
        outputFormat: { type: "json_schema", schema: EXTRACTION_JSON_SCHEMAS.buildDigest },
      },
      BuildDigestOutputSchema,
    );
  }
}
