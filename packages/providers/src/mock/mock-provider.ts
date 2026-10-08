import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AnalyzeProfilesOutput,
  BuildDigestOutput,
  ExtractFactsOutput,
  ReadDocumentOutput,
} from "@narnia-jobs/shared";
import {
  type AnalyzeProfilesProviderInput,
  type AuthMethod,
  approxTokens,
  type BuildDigestInput,
  type ExtractFactsInput,
  LOGIN_HINT,
  type Provider,
  ProviderError,
  type ProviderResult,
  type ProviderStatus,
  type ReadDocumentInput,
} from "../provider";
import {
  MOCK_ANALYZE_PROFILES,
  MOCK_DIGEST,
  MOCK_EXTRACT_FACTS,
  MOCK_READ_DOCUMENT,
} from "./fixtures";

export type MockOperation =
  | "detect"
  | "readDocument"
  | "extractFacts"
  | "buildDigest"
  | "analyzeProfiles";

export interface MockProviderOptions {
  installed?: boolean;
  loggedIn?: boolean;
  authMethod?: Exclude<AuthMethod, "none">;
  version?: string;
  /** Atraso artificial por operação (modo `slow`). */
  delayMs?: number;
  /** Mensagem de erro por operação (modo `error`); ausente = sucesso. */
  errors?: Partial<Record<MockOperation, string>>;
  /**
   * Arquivo JSON compartilhado entre processos (api e worker, F01-73): `setMode` grava, toda operação relê.
   * Sem arquivo, o modo fica só em memória.
   */
  modeFile?: string | null;
}

export type MockMode = Required<Omit<MockProviderOptions, "errors" | "modeFile">> & {
  errors: Partial<Record<MockOperation, string>>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_MODE: MockMode = {
  installed: true,
  loggedIn: true,
  authMethod: "claude.ai",
  version: "2.1.292",
  delayMs: 0,
  errors: {},
};

function definedOnly(patch: MockProviderOptions): Partial<MockMode> {
  const { modeFile: _ignored, ...rest } = patch;
  return Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined),
  ) as Partial<MockMode>;
}

/**
 * Provider de teste e desenvolvimento: nunca chama o modelo nem a assinatura. Modos controláveis em memória e,
 * com `modeFile`, compartilhados entre processos (a api recebe `POST /api/_test/mock`; o worker executa as etapas).
 */
export class MockProvider implements Provider {
  readonly id = "mock" as const;
  readonly modeFile: string | null;
  private mode: MockMode;

  constructor(options: MockProviderOptions = {}) {
    this.modeFile = options.modeFile ?? null;
    this.mode = { ...DEFAULT_MODE, ...definedOnly(options), errors: options.errors ?? {} };
  }

  /** Relê o arquivo compartilhado (se houver); arquivo ausente ou corrompido mantém o modo em memória. */
  private load(): void {
    if (!this.modeFile || !existsSync(this.modeFile)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.modeFile, "utf8")) as Partial<MockMode>;
      if (parsed && typeof parsed === "object") {
        this.mode = { ...DEFAULT_MODE, ...parsed, errors: parsed.errors ?? {} };
      }
    } catch {
      // JSON inválido: ignora e segue com o modo em memória
    }
  }

  private persist(): void {
    if (!this.modeFile) return;
    mkdirSync(dirname(this.modeFile), { recursive: true });
    writeFileSync(this.modeFile, JSON.stringify(this.mode), { mode: 0o600 });
  }

  getMode(): MockMode {
    this.load();
    return { ...this.mode, errors: { ...this.mode.errors } };
  }

  setMode(patch: MockProviderOptions): MockMode {
    this.load();
    this.mode = { ...this.mode, ...definedOnly(patch) } as MockMode;
    this.persist();
    return this.getMode();
  }

  /** Volta aos padrões (logado por volume, sem atraso, sem erros) e grava isso no arquivo compartilhado. */
  reset(): MockMode {
    this.mode = { ...DEFAULT_MODE, errors: {} };
    this.persist();
    return this.getMode();
  }

  private async gate(op: MockOperation): Promise<void> {
    this.load();
    if (this.mode.delayMs > 0) await sleep(this.mode.delayMs);
    const err = this.mode.errors[op];
    if (err) throw new ProviderError("simulated", err);
  }

  private result<T>(output: T, inputText: string, model: string): ProviderResult<T> {
    const inputTokens = Math.max(1, approxTokens(inputText) + 400);
    const outputTokens = Math.max(1, approxTokens(JSON.stringify(output)));
    return {
      output,
      usage: { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, model },
      costUsd: 0,
      sdk: { usage: { input_tokens: inputTokens, output_tokens: outputTokens }, total_cost_usd: 0 },
    };
  }

  async detect(): Promise<ProviderStatus> {
    await this.gate("detect");
    const { installed, loggedIn, authMethod, version } = this.mode;
    if (!installed) {
      return {
        installed: false,
        loggedIn: false,
        authMethod: "none",
        version: null,
        loginHint: LOGIN_HINT,
      };
    }
    if (!loggedIn) {
      return {
        installed: true,
        loggedIn: false,
        authMethod: "none",
        version,
        loginHint: LOGIN_HINT,
      };
    }
    return { installed: true, loggedIn: true, authMethod, version, loginHint: null };
  }

  async readDocument(input: ReadDocumentInput): Promise<ProviderResult<ReadDocumentOutput>> {
    await this.gate("readDocument");
    return this.result(structuredClone(MOCK_READ_DOCUMENT), input.filePath, input.model);
  }

  async extractFacts(input: ExtractFactsInput): Promise<ProviderResult<ExtractFactsOutput>> {
    await this.gate("extractFacts");
    return this.result(structuredClone(MOCK_EXTRACT_FACTS), input.text, input.model);
  }

  /** Sugestões fixas (EM e Staff) citando as duas primeiras experiências da entrada como fatos de apoio. */
  async analyzeProfiles(
    input: AnalyzeProfilesProviderInput,
  ): Promise<ProviderResult<AnalyzeProfilesOutput>> {
    await this.gate("analyzeProfiles");
    const supporting = input.experiences.slice(0, 2).map((e) => e.id);
    const output: AnalyzeProfilesOutput = {
      suggestions: MOCK_ANALYZE_PROFILES.suggestions.map((s) => ({
        ...s,
        supportingFactIds: supporting,
      })),
    };
    const { model, ...rest } = input;
    return this.result(output, JSON.stringify(rest), model);
  }

  async buildDigest(input: BuildDigestInput): Promise<ProviderResult<BuildDigestOutput>> {
    await this.gate("buildDigest");
    return this.result(
      structuredClone(MOCK_DIGEST),
      input.text + JSON.stringify(input.proposals),
      input.model,
    );
  }
}
