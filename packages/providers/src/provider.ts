import type {
  AnalyzeProfilesInput,
  AnalyzeProfilesOutput,
  AnalyzeRepoOutput,
  BuildDigestOutput,
  CheckProposalsOutput,
  ExtractFactsOutput,
  FactProposal,
  PickFilesOutput,
  PlanUsage,
  ReadDocumentOutput,
  RepoReport,
  SynthesizeRunOutput,
} from "@narnia-jobs/shared";
import type { ChatHandle, ChatOpenOptions } from "./chat";

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
  /** Login do volume esvaziado pelo CLI depois de uma renovação que falhou (sem refreshToken e acesso vencido). */
  authExpired?: boolean;
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
/** "Analisar possíveis perfis" (F02 §2.6): entrada compacta de todo o histórico + modelo escolhido. */
export type AnalyzeProfilesProviderInput = AnalyzeProfilesInput & { model: string };

/* ---------- F03 · ingestão do GitHub e revisão anti-alucinação (§2.4, §2.5, §2.8) ---------- */

/** Profunda: a chamada barata escolhe até `maxFiles` arquivos entre a árvore e os candidatos da heurística. */
export interface PickFilesInput {
  repo: string;
  tree: string[];
  candidates: string[];
  maxFiles: number;
  model: string;
}
/** Uma chamada por repositório, sem tools: o contexto já vem empacotado e limitado à fatia (`packContext`). */
export interface AnalyzeRepoInput {
  repo: string;
  context: string;
  model: string;
}
/** Síntese: só os relatórios dos repositórios e a tabela de métricas, nunca código. */
export interface SynthesizeRunInput {
  reports: Array<{ fullName: string; report: RepoReport }>;
  metricsTable: string;
  model: string;
}
/** Camada 2 do revisor (modelo mais barato): afirmação + trecho, julgamento só pelo trecho. */
export interface CheckProposalsInput {
  items: Array<{ proposalId: string; kind: string; claim: string; quote: string }>;
  model: string;
}

/** Avaliações no Phoenix (M1): chamada simples, sem tools, usada pela ponte da assinatura. */
export interface CompleteInput {
  system: string;
  prompt: string;
  model: string;
  /** Saída estruturada (JSON Schema); ausente = texto livre. */
  jsonSchema?: Record<string, unknown> | null;
}

export interface CompleteResult {
  text: string;
  /** Objeto da saída estruturada; null sem schema. */
  structured: unknown;
  /** Modelo exato que respondeu (o pedido pode ser um apelido). */
  model: string;
  usage: Usage;
  costUsd: number;
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
  /** Sugestões de perfil a partir de todo o histórico (F02-5; Sonnet por padrão, uma chamada). */
  analyzeProfiles(
    input: AnalyzeProfilesProviderInput,
  ): Promise<ProviderResult<AnalyzeProfilesOutput>>;
  /** F03 §2.5: escolha de arquivos (profunda), análise por repositório e síntese da execução. */
  pickFiles(input: PickFilesInput): Promise<ProviderResult<PickFilesOutput>>;
  analyzeRepo(input: AnalyzeRepoInput): Promise<ProviderResult<AnalyzeRepoOutput>>;
  synthesizeRun(input: SynthesizeRunInput): Promise<ProviderResult<SynthesizeRunOutput>>;
  /** F03 §2.8: camada 2 da revisão anti-alucinação. */
  checkProposals(input: CheckProposalsInput): Promise<ProviderResult<CheckProposalsOutput>>;
  /**
   * F03 §2.4: diagnóstico do plano (assinatura e uso das janelas). Nunca gasta tokens; `null` quando o plano não se
   * aplica (API key, terceiros) ou não há dado.
   */
  getPlanUsage(): Promise<PlanUsage | null>;
  /** Chamada simples ao modelo (ponte da assinatura para o Phoenix); `onText` recebe o texto em fragmentos. */
  complete(input: CompleteInput, onText?: (text: string) => void): Promise<CompleteResult>;
  /** F04 M3: sessão longa de chat com entrada em streaming e eventos normalizados (nunca lança: falha vira `error`). */
  openChat(opts: ChatOpenOptions): ChatHandle;
  /**
   * Janela de 5 h no instante, do último evento de limite visto (sem chamada nova; correções F03, item 11).
   * `null` quando não há dado (API key, mock sem plano).
   */
  planWindowSnapshot(): { utilization: number | null; resetsAt: string | null } | null;
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

/**
 * Login do volume que expirou (2026-10-12): o CLI esvazia a credencial quando a renovação falha. Vários processos
 * `claude` (worker e chat da api) renovando o mesmo login podem disputar o token de renovação; o token de longa
 * duração do `claude setup-token` não renova e evita a disputa.
 */
export const LOGIN_EXPIRED_HINT =
  "O login da assinatura expirou e não pôde ser renovado. Refaça com `./start.sh login` (ou `narnia-jobs login`). " +
  "Para não expirar de novo: gere um token com `claude setup-token` no host, defina CLAUDE_CODE_OAUTH_TOKEN no .env e reinicie.";

/** ~4 caracteres por token; usado pelo mock e por estimativas locais. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
