/**
 * Gate pairwise das avaliações (AV-5, AV-6): o prompt novo só substitui o aprovado se for upgrade. Cada caso do dataset
 * compara a saída da candidata com a da versão aprovada (guardada em `evals/approved/<prompt>.jsonl`, versionado no
 * git); um juiz cego escolhe A, B ou empate duas vezes, com a ordem trocada, e a discordância vira empate. Passa com
 * mais vitórias que derrotas (empates não contam), ou, na correção de casos específicos, com todos eles ganhos e nenhuma
 * derrota.
 */
export type PairPick = "A" | "B" | "empate";
export type PairOutcome = "ganhou" | "perdeu" | "empate";

export interface PairwiseCase {
  exampleId: string;
  outcome: PairOutcome;
  explanation: string;
}

export interface PairwiseDecision {
  passed: boolean;
  wins: number;
  losses: number;
  ties: number;
  reason: string;
}

/** Resultado da candidata: na 1ª chamada A = aprovada e B = candidata; na 2ª, a ordem trocada. */
export function pairOutcome(first: PairPick, swapped: PairPick): PairOutcome {
  if (first === "B" && swapped === "A") return "ganhou";
  if (first === "A" && swapped === "B") return "perdeu";
  return "empate";
}

export function pairwiseDecision(cases: PairwiseCase[], fixes: string[] = []): PairwiseDecision {
  const count = (o: PairOutcome) => cases.filter((c) => c.outcome === o).length;
  const wins = count("ganhou");
  const losses = count("perdeu");
  const ties = count("empate");
  const lost = cases.filter((c) => c.outcome === "perdeu").map((c) => c.exampleId);
  if (fixes.length > 0) {
    const notWon = fixes.filter(
      (id) => cases.find((c) => c.exampleId === id)?.outcome !== "ganhou",
    );
    const passed = notWon.length === 0 && losses === 0;
    const reason = passed
      ? `casos corrigidos ganhos (${fixes.join(", ")}) e nenhuma derrota`
      : [
          notWon.length ? `não ganhou o caso corrigido: ${notWon.join(", ")}` : "",
          lost.length ? `perdeu: ${lost.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("; ");
    return { passed, wins, losses, ties, reason };
  }
  const passed = wins > losses;
  const reason = passed
    ? `${wins} vitórias contra ${losses} derrotas`
    : wins === 0 && losses === 0
      ? "só empates: não é upgrade"
      : `${wins} vitórias contra ${losses} derrotas: não é upgrade${lost.length ? ` (perdeu: ${lost.join(", ")})` : ""}`;
  return { passed, wins, losses, ties, reason };
}

export interface ApprovedEvaluation {
  name: string;
  kind: "CODE" | "LLM";
  label: string;
  score: number;
  explanation: string;
}

/** Saída aprovada de um caso: lado A do pairwise e experimento "aprovada" no Phoenix. */
export interface ApprovedCase {
  exampleId: string;
  /** Hash do prompt (catálogo) aprovado. */
  versionId: string;
  commit: string | null;
  approvedAt: string;
  output: unknown;
  evaluations: ApprovedEvaluation[];
}

export function parseApproved(text: string | null): ApprovedCase[] {
  const out: ApprovedCase[] = [];
  for (const line of (text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      const c = JSON.parse(line) as Partial<ApprovedCase>;
      if (typeof c.exampleId !== "string" || typeof c.versionId !== "string") continue;
      out.push({
        exampleId: c.exampleId,
        versionId: c.versionId,
        commit: c.commit ?? null,
        approvedAt: String(c.approvedAt ?? ""),
        output: c.output ?? null,
        evaluations: Array.isArray(c.evaluations) ? c.evaluations : [],
      });
    } catch {
      // linha corrompida não derruba o arquivo inteiro
    }
  }
  return out;
}

/** Uma linha por caso, ordenada pelo id: o diff do git mostra só os casos que mudaram. */
export function serializeApproved(cases: ApprovedCase[]): string {
  return cases
    .slice()
    .sort((a, b) => a.exampleId.localeCompare(b.exampleId))
    .map((c) => `${JSON.stringify(c)}\n`)
    .join("");
}
