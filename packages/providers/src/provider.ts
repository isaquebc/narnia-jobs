import type {
  BuildDigestOutput,
  ExtractFactsOutput,
  FactProposal,
  ReadDocumentOutput,
} from "@narnia-jobs/shared";

/**
 * Contrato de provider (F01 §2.4). `detect` nunca gasta tokens; as três operações de extração chamam o modelo
 * (leitura do documento, fatos, digest) e devolvem saída validada + uso normalizado + o trecho bruto do SDK.
 */
export type AuthMethod =
  | "none"
  | "claude.ai"
  | "oauth_token"
  | "api_key"
  | "api_key_helper"
  | "third_party";

export interface ProviderStatus {
  installed: boolean;
  loggedIn: boolean;
  authMethod: AuthMethod;
  version: string | null;
  /** Instruções acionáveis quando não logado (dois caminhos: volume e token). */
  loginHint: string | null;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
}

/** Trecho do `result` do Agent SDK que o `core` sabe normalizar (`usageFromSdkResult`). */
export interface SdkResultLike {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  total_cost_usd?: number;
}

export interface ProviderResult<T> {
  output: T;
  usage: Usage;
  costUsd: number;
  sdk: SdkResultLike;
}

export interface ReadDocumentInput {
  /** Caminho absoluto do arquivo dentro da pasta de uploads; o modelo só enxerga essa pasta. */
  filePath: string;
  locale: string;
  model: string;
}
export interface ExtractFactsInput {
  text: string;
  locale: string;
  model: string;
}
export interface BuildDigestInput {
  text: string;
  proposals: FactProposal[];
  locale: string;
  model: string;
}

export interface Provider {
  readonly id: "claude-code" | "mock";
  detect(): Promise<ProviderStatus>;
  /** Leitura 3 do PDF (decisão F01-3): o modelo lê o arquivo com a tool Read. */
  readDocument(input: ReadDocumentInput): Promise<ProviderResult<ReadDocumentOutput>>;
  /** Fatos candidatos (Haiku por padrão, decisão F01-5). */
  extractFacts(input: ExtractFactsInput): Promise<ProviderResult<ExtractFactsOutput>>;
  /** Registro de contexto do arquivo (Sonnet por padrão, decisão F01-5). */
  buildDigest(input: BuildDigestInput): Promise<ProviderResult<BuildDigestOutput>>;
}

export type ProviderErrorCode =
  | "not_installed"
  | "not_logged_in"
  | "query_failed"
  | "structured_output_failed"
  | "invalid_output"
  | "simulated";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  override readonly cause?: unknown;
  constructor(code: ProviderErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.cause = cause;
  }
}

export const LOGIN_HINT =
  "Não logado. Caminho padrão: rode `./start.sh login` (ou `narnia-jobs login`) para entrar com a assinatura dentro do container. " +
  "Alternativa: gere um token com `claude setup-token` no host e defina CLAUDE_CODE_OAUTH_TOKEN no .env.";

/** ~4 caracteres por token; usado pelo mock e por estimativas locais. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
