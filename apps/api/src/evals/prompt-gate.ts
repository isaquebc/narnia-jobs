import type { ApprovedCase } from "@narnia-jobs/core";
import type { FeatureResult, GateFlags, PairRun } from "./baseline-file";
import { JUDGE_NAME } from "./judges";
import type { PromptExample } from "./phoenix-run";

/**
 * Gate dos prompts estruturados com amostras (pedido do dono, 2026-10-29): com uma amostra por caso, a regra das etapas
 * no `posting.extract` reprovou por derrotas em campos sem relação com ela. Como no gate do chat, o prompt que mudou
 * roda N vezes cada caso dos dois lados (a versão aprovada também, pelo histórico do Phoenix), o placar soma as
 * amostras, `--feature` declara os casos novos e `--noise` mede o acaso (A contra A) por prompt.
 */
export interface PromptGatePlan {
  /** single: uma rodada; compare: prompt mudou ou tem caso novo; noise: A contra A; skip: fora desta rodada. */
  mode: "single" | "compare" | "noise" | "skip";
  /** Repetições de cada exemplo no experimento da candidata (no A contra A, 2N: metade de cada lado). */
  repetitions: number;
  /** Roda a versão aprovada (lado A) com as mesmas repetições. */
  approvedSide: boolean;
  /** Casos novos de `--feature` que são deste prompt. */
  feature: string[];
  reason?: string;
}

export function promptGatePlan(o: {
  flags: GateFlags;
  hash: string;
  approved: ApprovedCase[];
  exampleIds: string[];
}): PromptGatePlan {
  const { flags } = o;
  const changed = o.approved.some((a) => a.versionId !== o.hash);
  const feature = (flags.feature ?? []).filter((id) => o.exampleIds.includes(id));
  if (flags.noise) {
    if (o.approved.length === 0)
      return {
        mode: "skip",
        repetitions: 0,
        approvedSide: false,
        feature: [],
        reason: "sem aprovada",
      };
    if (changed)
      return {
        mode: "skip",
        repetitions: 0,
        approvedSide: false,
        feature: [],
        reason: "mudou desde a aprovada",
      };
    return {
      mode: "noise",
      repetitions: 2 * (flags.samples ?? 3),
      approvedSide: false,
      feature: [],
    };
  }
  const comparing = flags.gate || flags.update;
  if (comparing && o.approved.length > 0 && (changed || feature.length > 0))
    return { mode: "compare", repetitions: flags.samples ?? 5, approvedSide: changed, feature };
  return { mode: "single", repetitions: 1, approvedSide: false, feature: [] };
}

/** A contra A: as repetições 1..N são a candidata, N+1..2N o lado A (cada lado renumerado a partir de 1). */
export function splitRepetitions(
  examples: PromptExample[],
  n: number,
): { candidate: PromptExample[]; against: PromptExample[] } {
  const side = (from: number, to: number) =>
    examples.map((e) => {
      const samples = e.samples
        .filter((s) => s.repetition >= from && s.repetition <= to)
        .map((s) => ({ ...s, repetition: s.repetition - from + 1 }));
      const first = samples[0];
      return {
        exampleId: e.exampleId,
        runId: first?.runId ?? null,
        output: first?.output ?? null,
        evaluations: first?.evaluations ?? [],
        ...(first?.error ? { error: first.error } : {}),
        samples,
      };
    });
  return { candidate: side(1, n), against: side(n + 1, 2 * n) };
}

/** Pares do pairwise: a primeira amostra, as extras e, se houver, as amostras do lado A do mesmo exemplo. */
export function promptPairRuns(
  candidate: PromptExample[],
  rows: Map<string, { input: unknown; output: unknown; metadata: unknown }>,
  against?: PromptExample[],
): PairRun[] {
  const sideA = new Map((against ?? []).map((e) => [e.exampleId, e]));
  return candidate.map((e) => {
    const row = rows.get(e.exampleId);
    const a = sideA.get(e.exampleId);
    const error =
      [...e.samples, ...(a?.samples ?? [])].find((s) => s.error)?.error ??
      (e.runId ? undefined : "sem execução");
    return {
      exampleId: e.exampleId,
      ctx: { input: row?.input, reference: row?.output, metadata: row?.metadata },
      output: e.output,
      evaluations: e.evaluations,
      error,
      samples: e.samples.slice(1).map((s) => s.output),
      ...(a ? { against: a.samples.map((s) => s.output) } : {}),
    };
  });
}

/** Caso novo (`--feature`): passa se a maioria das amostras passa nos avaliadores de código e o juiz não reprova. */
export function featureResults(examples: PromptExample[], ids: string[]): FeatureResult[] {
  return ids.flatMap((id) => {
    const e = examples.find((x) => x.exampleId === id);
    if (!e) return [];
    const ok = e.samples.filter(
      (s) =>
        !s.error &&
        s.evaluations.length > 0 &&
        s.evaluations.every((v) => (v.name === JUDGE_NAME ? v.score >= 0.5 : v.score >= 1)),
    ).length;
    return [
      {
        exampleId: id,
        passed: ok * 2 > e.samples.length,
        detail: `${ok} de ${e.samples.length} amostras passaram nos avaliadores e no juiz`,
      },
    ];
  });
}

/**
 * Variação da nota entre as repetições (A contra A): a média de cada avaliador por repetição; devolve o maior intervalo
 * (máximo − mínimo) entre os avaliadores. Vira a tolerância das médias do prompt na linha de base.
 */
export function repetitionSpread(examples: PromptExample[]): number {
  const acc = new Map<string, Map<number, { sum: number; n: number }>>();
  for (const e of examples)
    for (const s of e.samples)
      for (const v of s.evaluations) {
        const byRep = acc.get(v.name) ?? new Map();
        acc.set(v.name, byRep);
        const a = byRep.get(s.repetition) ?? { sum: 0, n: 0 };
        byRep.set(s.repetition, { sum: a.sum + v.score, n: a.n + 1 });
      }
  let spread = 0;
  for (const byRep of acc.values()) {
    const means = [...byRep.values()].map((a) => a.sum / a.n);
    if (means.length > 1) spread = Math.max(spread, Math.max(...means) - Math.min(...means));
  }
  return spread;
}
