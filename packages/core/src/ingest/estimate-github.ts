import type { IngestionDepth, RepoAnalysisKind } from "@narnia-jobs/shared";
import { type CallEstimate, estimateCall, PROMPT_OVERHEAD } from "../estimate";
import type { IngestModels } from "./settings";

/**
 * Estimativa do GitHub (F03 §2.4) sobre `estimateCall` da F02: por repositório (escolha de arquivos na profunda +
 * análise), síntese (lê só os relatórios + métricas) e revisor anti-alucinação. Antes da coleta usa o tamanho
 * típico da profundidade; depois da coleta, o tamanho real do contexto montado.
 */
export const TYPICAL_CONTEXT_CHARS: Record<IngestionDepth, number> = {
  quick: 6_000,
  balanced: 24_000,
  deep: 48_000,
};
export const TYPICAL_TREE_CHARS = 6_000;
/** Relatório de um repositório que entra na síntese. */
export const REPORT_CHARS = 1_500;
export const PROPOSALS_PER_REPO = 8;
export const CHECK_CHARS_PER_PROPOSAL = 300;

export interface NamedCall extends CallEstimate {
  name: string;
}

export interface RepoEstimate {
  fullName: string;
  calls: NamedCall[];
  tokens: number;
}

export function estimateRepo(i: {
  fullName: string;
  depth: IngestionDepth;
  kind?: RepoAnalysisKind;
  contextChars?: number;
  treeChars?: number;
  models: IngestModels;
}): RepoEstimate {
  const calls: NamedCall[] = [];
  if (i.depth === "deep" && (i.kind ?? "full") !== "incremental") {
    calls.push({
      name: "pick",
      ...estimateCall({
        inputChars: i.treeChars ?? TYPICAL_TREE_CHARS,
        overhead: PROMPT_OVERHEAD.pickFiles,
        model: i.models.pick,
      }),
    });
  }
  calls.push({
    name: "repo",
    ...estimateCall({
      inputChars: i.contextChars ?? TYPICAL_CONTEXT_CHARS[i.depth],
      overhead: PROMPT_OVERHEAD.analyzeRepo,
      model: i.models.repo,
    }),
  });
  return { fullName: i.fullName, calls, tokens: calls.reduce((n, c) => n + c.tokens, 0) };
}

export interface GithubRunEstimate {
  calls: NamedCall[];
  perRepo: RepoEstimate[];
  synthesisTokens: number;
  checkTokens: number;
  totalTokens: number;
}

export function estimateRun(i: {
  depth: IngestionDepth;
  models: IngestModels;
  checkEnabled: boolean;
  metricsChars: number;
  repos: { fullName: string; contextChars?: number; treeChars?: number; kind?: RepoAnalysisKind }[];
}): GithubRunEstimate {
  const perRepo = i.repos.map((r) => estimateRepo({ ...r, depth: i.depth, models: i.models }));
  const n = i.repos.length;
  const synthesis: NamedCall = {
    name: "synthesis",
    ...estimateCall({
      inputChars: n * REPORT_CHARS + i.metricsChars,
      overhead: PROMPT_OVERHEAD.synthesizeRun,
      model: i.models.synthesis,
    }),
  };
  const check: NamedCall | null = i.checkEnabled
    ? {
        name: "check",
        ...estimateCall({
          inputChars: n * PROPOSALS_PER_REPO * CHECK_CHARS_PER_PROPOSAL,
          overhead: PROMPT_OVERHEAD.checkProposals,
          model: i.models.check,
        }),
      }
    : null;
  const calls = [
    ...perRepo.flatMap((r) => r.calls.map((c) => ({ ...c, name: `${c.name}:${r.fullName}` }))),
    synthesis,
    ...(check ? [check] : []),
  ];
  return {
    calls,
    perRepo,
    synthesisTokens: synthesis.tokens,
    checkTokens: check?.tokens ?? 0,
    totalTokens: calls.reduce((s, c) => s + c.tokens, 0),
  };
}
