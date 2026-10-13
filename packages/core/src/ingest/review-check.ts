import {
  BENEFIT_LABELS,
  type CheckProposalsOutput,
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

/** `sources`: conteúdo enviado ao modelo, por referência (`cv`, `README.md`, caminho do arquivo…). */
export function checkEvidence(
  evidence: Evidence | null | undefined,
  sources: Record<string, string>,
): Extract<CheckStatus, "unchecked" | "unsupported"> {
  const quote = evidence ? squash(evidence.quote) : "";
  if (!evidence || quote.length < MIN_QUOTE) return "unsupported";
  const direct = sources[evidence.ref];
  if (direct !== undefined && squash(direct).includes(quote)) return "unchecked";
  // o modelo erra o nome da fonte com frequência ("README" × "README.md"): procura em todas as enviadas
  return Object.values(sources).some((s) => squash(s).includes(quote))
    ? "unchecked"
    : "unsupported";
}

export function runCheckLayer1(
  repos: Repos,
  runId: string,
  sources: Record<string, string>,
): { unchecked: number; unsupported: number } {
  const counts = { unchecked: 0, unsupported: 0 };
  for (const p of repos.proposals.listByRun(runId)) {
    if (p.decision !== "pending") continue;
    const status = checkEvidence(p.evidence, sources);
    repos.proposals.setCheckStatus(p.id, status);
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
      repos.proposals.setCheckStatus(r.proposalId, r.status);
      n++;
    } catch {
      // proposta inexistente (o modelo inventou um id): ignora
    }
  }
  return n;
}
