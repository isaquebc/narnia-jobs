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
  /** Resultado de cada amostra do caso (gate robusto): o placar soma as amostras. */
  samples?: PairOutcome[] | undefined;
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

/**
 * Maioria das amostras de um caso (gate robusto, 2026-10-25): vale o saldo de vitórias e derrotas; saldo zero, empate.
 */
export function majorityOutcome(outcomes: PairOutcome[]): PairOutcome {
  const balance = outcomes.reduce(
    (sum, o) => sum + (o === "ganhou" ? 1 : o === "perdeu" ? -1 : 0),
    0,
  );
  return balance > 0 ? "ganhou" : balance < 0 ? "perdeu" : "empate";
}

/**
 * Placar por amostra (decisão do dono 2026-10-26): com poucos casos afetados, a maioria por caso jogava informação fora
 * (1 vitória e 2 derrotas valiam o mesmo que 3 derrotas) e o veredito da mesma versão mudava de uma rodada para outra.
 * Caso sem amostras conta uma vez, pelo resultado dele.
 */
export function tallySamples(cases: PairwiseCase[]): {
  wins: number;
  losses: number;
  ties: number;
} {
  const all = cases.flatMap((c) => c.samples ?? [c.outcome]);
  const count = (o: PairOutcome) => all.filter((x) => x === o).length;
  return { wins: count("ganhou"), losses: count("perdeu"), ties: count("empate") };
}

/**
 * Margem do saldo (vitórias − derrotas) para ser upgrade. O teste A contra A mede a fração de casos que o acaso decide
 * (`decisiveRate`, a mesma versão contra a aprovada; por amostra desde 2026-10-26); entre `n` pares julgados, o saldo
 * do acaso tem desvio padrão √(taxa · n), e a margem é esse desvio arredondado para cima. Sem medição, 1 (ganhar mais
 * do que perder).
 */
export function noiseMargin(decisiveRate: number | undefined, n: number): number {
  if (!decisiveRate || decisiveRate <= 0 || n <= 0) return 1;
  return Math.max(1, Math.ceil(Math.sqrt(decisiveRate * n) - 1e-9));
}

/** Dependências de um caso (nome do prompt → hash): mudou se algum dos dois lados tem um que falta ou difere. */
export function depsChanged(
  approved: Record<string, string> | undefined,
  candidate: Record<string, string> | undefined,
): boolean {
  if (!approved || !candidate) return true;
  const names = new Set([...Object.keys(approved), ...Object.keys(candidate)]);
  return [...names].some((n) => approved[n] !== candidate[n]);
}

/**
 * `upgrade` (padrão, AV-5): saldo de vitórias ≥ margem. `nao_inferior` (`--feature`, decisão do dono 2026-10-25): a
 * mudança acrescenta funcionalidade e os casos antigos afetados só não podem piorar além do ruído (derrotas − vitórias
 * < margem).
 */
export type PairwiseMode = "upgrade" | "nao_inferior";

export function pairwiseDecision(
  cases: PairwiseCase[],
  fixes: string[] = [],
  margin = 1,
  mode: PairwiseMode = "upgrade",
): PairwiseDecision {
  const perSample = cases.some((c) => c.samples);
  const { wins, losses, ties } = tallySamples(cases);
  const unit = perSample ? " (por amostra)" : "";
  const lost = cases.filter((c) => c.outcome === "perdeu").map((c) => c.exampleId);
  if (fixes.length > 0) {
    // correção de casos: vale o caso inteiro (maioria das amostras)
    const count = (o: PairOutcome) => cases.filter((c) => c.outcome === o).length;
    const [wins, losses, ties] = [count("ganhou"), count("perdeu"), count("empate")];
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
  if (mode === "nao_inferior") {
    const passed = losses - wins < margin;
    const head = `${wins} vitórias, ${losses} derrotas, ${ties} empates${unit}`;
    return {
      passed,
      wins,
      losses,
      ties,
      reason: passed
        ? `${head}: não-inferior (margem do ruído: ${margin})`
        : `${head}: inferior além do ruído (margem: ${margin}; perdeu: ${lost.join(", ")})`,
    };
  }
  const passed = wins - losses >= margin;
  const noise = margin > 1 ? `; margem do ruído: ${margin}` : "";
  const reason = passed
    ? `${wins} vitórias contra ${losses} derrotas${unit}${noise}`
    : wins === 0 && losses === 0
      ? "só empates: não é upgrade"
      : `${wins} vitórias contra ${losses} derrotas${unit}: não é upgrade${noise}${lost.length ? ` (perdeu: ${lost.join(", ")})` : ""}`;
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
  /**
   * Prompts de que a saída dependeu (nome → hash; gate robusto, 2026-10-25): o pairwise só compara o caso quando algum
   * deles mudou. Sem o campo (arquivo antigo), o caso conta como mudado.
   */
  deps?: Record<string, string> | undefined;
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
        ...(c.deps && typeof c.deps === "object" ? { deps: c.deps } : {}),
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
