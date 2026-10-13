import {
  BENEFIT_LABELS,
  type CheckProposalsOutput,
  type CheckReason,
  type CheckStatus,
  CONTRACT_TYPE_LABELS,
  type Evidence,
  type FactProposal,
  formatCompensation,
} from "@narnia-jobs/shared";
import type { Repos } from "../db";
import type { ProposalRecord } from "../db/repos/proposals";

/**
 * Revisão anti-alucinação (F03-3 §8, F03-12). Camada 1, sem tokens: o trecho citado tem de existir literalmente
 * (normalizando espaços e quebras) no conteúdo enviado ao modelo; senão a proposta é `unsupported`. As que passam
 * ficam `unchecked` para a camada 2 (modelo mais barato, em lote), que devolve `supported | partial | unsupported`.
 * Nada é apagado: o selo aparece na revisão e o usuário decide.
 */
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const MIN_QUOTE = 3;

/**
 * Forma comparável (2026-10-13): o modelo "arruma" o trecho e o PDF deforma o texto, então a conferência ignora a
 * forma e exige o conteúdo. Ligaduras (ﬁ → fi, NFKC), palavra quebrada no fim da linha ("desenvol-\nvimento"),
 * aspas e travessões tipográficos, acentos, maiúsculas e espaços.
 */
export function matchable(s: string): string {
  return squash(
    s
      .normalize("NFKC")
      .replace(/(\p{L})[-\u00ad\u2010\u2011]\s*\n\s*(\p{L})/gu, "$1$2")
      .replace(/[\u2018\u2019\u201a\u201b\u2032`´]/g, "'")
      .replace(/[\u201c\u201d\u201e\u201f\u2033\u00ab\u00bb]/g, '"')
      .replace(/[\u2010-\u2015\u2212]/g, "-")
      .replace(/\u2026/g, "...")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase(),
  );
}

type Layer1 = {
  status: Extract<CheckStatus, "unchecked" | "unsupported">;
  reason: CheckReason | null;
};

function layer1(evidence: Evidence | null | undefined, sources: Record<string, string>): Layer1 {
  if (!evidence) return { status: "unsupported", reason: { layer: 1, code: "no_evidence" } };
  const quote = matchable(evidence.quote);
  if (quote.length < MIN_QUOTE)
    return { status: "unsupported", reason: { layer: 1, code: "quote_too_short" } };
  const direct = sources[evidence.ref];
  // o modelo erra o nome da fonte com frequência ("README" × "README.md"): procura em todas as enviadas
  const found =
    (direct !== undefined && matchable(direct).includes(quote)) ||
    Object.values(sources).some((s) => matchable(s).includes(quote));
  return found
    ? { status: "unchecked", reason: null }
    : { status: "unsupported", reason: { layer: 1, code: "quote_not_found" } };
}

/** `sources`: conteúdo enviado ao modelo, por referência (`cv`, `README.md`, caminho do arquivo…). */
export function checkEvidence(
  evidence: Evidence | null | undefined,
  sources: Record<string, string>,
): Extract<CheckStatus, "unchecked" | "unsupported"> {
  return layer1(evidence, sources).status;
}

export function runCheckLayer1(
  repos: Repos,
  runId: string,
  sources: Record<string, string>,
): { unchecked: number; unsupported: number } {
  const counts = { unchecked: 0, unsupported: 0 };
  for (const p of repos.proposals.listByRun(runId)) {
    if (p.decision !== "pending") continue;
    const { status, reason } = layer1(p.evidence, sources);
    repos.proposals.setCheckStatus(p.id, status, reason);
    counts[status]++;
  }
  return counts;
}

/** Frase curta que o revisor confronta com o trecho. */
export function claimOf(p: FactProposal): string {
  switch (p.kind) {
    case "experience": {
      const d = p.data;
      const terms = [
        [
          d.employmentType ? CONTRACT_TYPE_LABELS[d.employmentType] : null,
          d.weeklyHours ? `${d.weeklyHours} h/semana` : null,
        ]
          .filter(Boolean)
          .join(", "),
        d.compensation ? `salário ${formatCompensation(d.compensation, d.weeklyHours)}` : "",
        [...(d.benefits ?? []).map((b) => BENEFIT_LABELS[b]), ...(d.benefitsOther ?? [])].length
          ? `benefícios: ${[...(d.benefits ?? []).map((b) => BENEFIT_LABELS[b]), ...(d.benefitsOther ?? [])].join(", ")}`
          : "",
      ].filter(Boolean);
      return `experiência: ${d.title} em ${d.company} (${d.startDate}–${d.isCurrent ? "atual" : (d.endDate ?? "?")})${terms.length ? `; ${terms.join("; ")}` : ""}`;
    }
    case "achievement":
      return `conquista: ${p.data.text}${p.data.metric ? ` (${p.data.metric})` : ""}`;
    case "education":
      return `formação: ${p.data.course} em ${p.data.institution}`;
    case "skill":
      return `skill: ${p.data.name}`;
    case "language":
      return `idioma: ${p.data.name} (${p.data.level})`;
    case "project":
      return `projeto: ${p.data.name}${p.data.description ? ` — ${p.data.description}` : ""}`;
    case "link":
      return `link: ${p.data.url}`;
    default:
      return `identidade: ${JSON.stringify(p.data)}`;
  }
}

export interface CheckBatchItem {
  proposalId: string;
  kind: string;
  claim: string;
  quote: string;
}

/** Entrada da camada 2: só pendentes que passaram na camada 1. */
export function buildCheckBatch(proposals: ProposalRecord[]): CheckBatchItem[] {
  return proposals
    .filter((p) => p.decision === "pending" && p.checkStatus === "unchecked" && p.evidence)
    .map((p) => ({
      proposalId: p.id,
      kind: p.kind,
      claim: claimOf(p.proposal),
      quote: (p.evidence as Evidence).quote,
    }));
}

/** Grava o veredito da camada 2; ids que não existem são ignorados. */
export function applyCheckResults(repos: Repos, results: CheckProposalsOutput["results"]): number {
  let n = 0;
  for (const r of results) {
    try {
      repos.proposals.setCheckStatus(
        r.proposalId,
        r.status,
        r.status === "supported"
          ? null
          : { layer: 2, code: "reviewer", ...(r.note ? { note: r.note } : {}) },
      );
      n++;
    } catch {
      // proposta inexistente (o modelo inventou um id): ignora
    }
  }
  return n;
}
