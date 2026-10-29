import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ApprovedCase,
  type ApprovedEvaluation,
  BASELINE_TOLERANCE,
  type Baselines,
  depsChanged,
  findRegressions,
  majorityOutcome,
  noiseMargin,
  type PairOutcome,
  type PairwiseCase,
  type PairwiseDecision,
  pairwiseDecision,
  parseApproved,
  parseBaselines,
  type Regression,
  serializeApproved,
  serializeBaselines,
  tallySamples,
} from "@narnia-jobs/core";
import type { CompleteInput, CompleteResult } from "@narnia-jobs/providers";
import { nowUtc } from "@narnia-jobs/shared";
import type { JudgeDef } from "./judges";
import { judgePair } from "./pairwise";

/**
 * Linha de base das avaliações em `evals/baselines.json` (F06-14): versionada no git, então quem clona o projeto tem o
 * mesmo bloqueador. `--gate` falha a rodada que regride; `--update-baseline` grava as notas de uma rodada sem regressão.
 */
const repoRoot = () => fileURLToPath(new URL("../../../../", import.meta.url));

export function baselinePath(): string {
  return process.env.NARNIA_EVAL_BASELINES ?? join(repoRoot(), "evals/baselines.json");
}

export function readBaselines(path = baselinePath()): Baselines {
  return parseBaselines(existsSync(path) ? readFileSync(path, "utf8") : null);
}

export interface GateFlags {
  gate: boolean;
  update: boolean;
  /** `--fixes=id,…`: casos que a mudança corrige (AV-5: ganhos e nenhuma derrota). */
  fixes: string[];
  /**
   * `--seed-approved`: grava a primeira versão aprovada dos prompts que ainda não têm uma, sem pairwise e sem olhar a
   * linha de base (a nota do juiz oscila de uma rodada para outra; o dono pediu as versões atuais como iniciais,
   * 2026-10-22). Não grava a linha de base nem regrava aprovada existente; rodada incompleta não grava nada.
   */
  seed?: boolean;
  /**
   * `--samples=N` (gate robusto, 2026-10-25): amostras por caso afetado no pairwise (padrão 5 no gate, 3 no `--noise`);
   * o placar soma as amostras (2026-10-26). Uma amostra só oscilava mais do que o efeito medido.
   */
  samples?: number;
  /**
   * `--feature=id,…` (não-inferioridade, decisão do dono 2026-10-25): a mudança acrescenta funcionalidade; os casos
   * novos listados precisam passar, e os antigos afetados só não podem piorar além do ruído.
   */
  feature?: string[];
  /** `--noise`: teste A contra A nos casos sem mudança; grava a fração decidida pelo acaso (`ruido:<chave>`). */
  noise?: boolean;
  /**
   * `--owner-approved` (2026-10-26): o gate reprovou e o dono aprovou explicitamente na conversa; com
   * `--update-baseline`, grava a linha de base e as versões aprovadas mesmo com regressão ou sem upgrade, com o motivo
   * no log. Só a pedido do dono, registrado no plano; rodada incompleta continua sem gravar.
   */
  ownerApproved?: boolean;
}

export function gateFlags(args: string[]): GateFlags {
  const fixes = args.find((a) => a.startsWith("--fixes="))?.slice("--fixes=".length) ?? "";
  const feature = args.find((a) => a.startsWith("--feature="))?.slice("--feature=".length);
  const samples = Number(args.find((a) => a.startsWith("--samples="))?.slice("--samples=".length));
  return {
    gate: args.includes("--gate"),
    update: args.includes("--update-baseline"),
    fixes: fixes.split(",").filter(Boolean),
    ...(args.includes("--seed-approved") ? { seed: true } : {}),
    ...(Number.isInteger(samples) && samples > 0 ? { samples } : {}),
    ...(args.includes("--noise") ? { noise: true } : {}),
    ...(args.includes("--owner-approved") ? { ownerApproved: true } : {}),
    ...(feature ? { feature: feature.split(",").filter(Boolean) } : {}),
  };
}

/** Saídas aprovadas (AV-6) ao lado da linha de base: `evals/approved/<prompt>.jsonl`. */
export function approvedPath(key: string, baselines = baselinePath()): string {
  return join(dirname(baselines), "approved", `${key.replace(/[^\w.-]+/g, "_")}.jsonl`);
}

export function readApproved(key: string, baselines = baselinePath()): ApprovedCase[] {
  const p = approvedPath(key, baselines);
  return parseApproved(existsSync(p) ? readFileSync(p, "utf8") : null);
}

/** Um caso da rodada candidata para o pairwise: contexto do juiz (entrada), saída e notas. */
export interface PairRun {
  exampleId: string;
  ctx: Record<string, unknown>;
  output: unknown;
  evaluations: ApprovedEvaluation[];
  error?: string | undefined;
  /** Prompts de que o caso dependeu (nome → hash): com elas, só o caso que mudou entra no pairwise. */
  deps?: Record<string, string> | undefined;
  /** Saídas das amostras extras do caso (a primeira é `output`). */
  samples?: unknown[] | undefined;
  /**
   * Amostras novas da versão aprovada, pareadas com as da candidata (gate robusto, 2026-10-25): a saída guardada é a
   * amostra que venceu o gate anterior (acima da média), e no A contra A ela ganhou 7 de 7 casos decididos. Sem elas,
   * o lado A é a saída guardada.
   */
  against?: unknown[] | undefined;
}

/** Chave do ruído medido pelo A contra A na linha de base. */
export const noiseKey = (key: string) => `ruido:${key}`;

export interface NoiseReport {
  key: string;
  /** Casos sem mudança comparados com a aprovada. */
  cases: number;
  samples: number;
  /** Pares julgados (casos × amostras). */
  pairs: number;
  /** Fração dos pares que o acaso decidiu (vitória ou derrota de uma amostra; por amostra desde 2026-10-26). */
  decisiveRate: number;
  /** Variação das notas médias entre as amostras (máximo − mínimo), por chave da linha de base. */
  spreads: Record<string, number>;
  outcomes: PairwiseCase[];
}

export interface PairwiseReport {
  key: string;
  /** pulado: sem --gate/--update-baseline; igual: versão já aprovada; primeira: sem aprovada; comparado: placar. */
  status: "pulado" | "igual" | "primeira" | "comparado";
  decision: PairwiseDecision | null;
  cases: PairwiseCase[];
  /** Casos sem mudança nas dependências: ficam fora do placar e mantêm a aprovada. */
  skipped: string[];
  /** `--feature`: resultado dos casos novos (a maioria das amostras passou em tudo). */
  features: FeatureResult[];
}

/** Caso novo de uma mudança `--feature`: passou se a maioria das amostras passou nos avaliadores e no juiz. */
export interface FeatureResult {
  exampleId: string;
  passed: boolean;
  detail: string;
}

/** Acumula as rodadas de um comando e, no fim, decide (regressões) e grava (atualização). */
export class BaselineGate {
  private readonly baselines: Baselines;
  private readonly runs: Array<{
    key: string;
    scores: Record<string, number>;
    versionId?: string | undefined;
    commit?: string | undefined;
    /** Erros do modelo na rodada (ou nenhuma nota): a rodada não vale como linha de base. */
    incomplete: number;
  }> = [];
  readonly regressions: Regression[] = [];
  readonly comparisons: PairwiseReport[] = [];
  /** Saídas candidatas a virar a aprovada, gravadas no fim se nada reprovar. */
  private readonly staged = new Map<string, ApprovedCase[]>();
  readonly noises: NoiseReport[] = [];

  constructor(
    readonly flags: GateFlags,
    private readonly path = baselinePath(),
  ) {
    this.baselines = readBaselines(path);
  }

  /** `gate: false` guarda a nota na linha de base sem bloquear (nota de uma amostra só, para consulta). */
  record(
    key: string,
    scores: Record<string, number>,
    meta: {
      versionId?: string;
      commit?: string;
      gate?: boolean;
      errors?: number;
      /** Amostras por caso na média de `scores` (gate dos estruturados): a tolerância cai com √N. */
      samples?: number;
    } = {},
  ): Regression[] {
    const found =
      meta.gate === false
        ? []
        : findRegressions(this.baselines, key, scores, this.tolerance(key, meta.samples));
    this.regressions.push(...found);
    const incomplete = (meta.errors ?? 0) + (Object.keys(scores).length === 0 ? 1 : 0);
    this.runs.push({ key, scores, versionId: meta.versionId, commit: meta.commit, incomplete });
    return found;
  }

  /**
   * Tolerância da nota: a padrão ou, se maior, a variação medida pelo A contra A (`ruido:*`). O ruído mede a média de
   * uma repetição; a média de N amostras varia √N vezes menos (2026-10-29: com 1–2 casos, uma nota "parcial" do juiz
   * movia a média de uma repetição em 50 pontos, e essa tolerância deixava passar quase qualquer queda).
   */
  private tolerance(key: string, samples = 1): number {
    const measured = Object.entries(this.baselines)
      .filter(([k]) => k.startsWith("ruido:"))
      .map(([, e]) => e.scores[key] ?? 0);
    return Math.max(BASELINE_TOLERANCE, ...measured.map((m) => m / Math.sqrt(samples)));
  }

  /** Julga cada amostra do caso contra a aprovada; o caso mostra a maioria, e o placar soma as amostras. */
  private async judgeCase(
    o: {
      judge: JudgeDef;
      provider: { complete(input: CompleteInput): Promise<CompleteResult> };
    },
    r: PairRun,
    approved: ApprovedCase,
  ): Promise<PairwiseCase> {
    const outputs = [r.output, ...(r.samples ?? [])];
    const judged = await Promise.all(
      outputs.map((candidate, i) =>
        judgePair(o.provider, o.judge, r.ctx, {
          approved: r.against?.[i] ?? approved.output,
          candidate,
        }),
      ),
    );
    const outcomes = judged.map((j) => j.outcome);
    if (judged.length === 1)
      return {
        exampleId: r.exampleId,
        outcome: outcomes[0] as PairOutcome,
        explanation: judged[0]?.explanation ?? "",
      };
    const n = (x: PairOutcome) => outcomes.filter((y) => y === x).length;
    const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
    return {
      exampleId: r.exampleId,
      outcome: majorityOutcome(outcomes),
      samples: outcomes,
      explanation: `${judged.length} amostras: ${plural(n("ganhou"), "vitória", "vitórias")}, ${plural(n("perdeu"), "derrota", "derrotas")}, ${plural(n("empate"), "empate", "empates")} · ${judged.map((j, i) => `[${i + 1}] ${j.explanation}`).join(" · ")}`,
    };
  }

  /**
   * Teste A contra A (gate robusto, 2026-10-25): os casos sem mudança nas dependências, com várias amostras, contra a
   * aprovada. A fração que o acaso decide vira a margem do pairwise e a variação das médias, a tolerância das notas;
   * fica na linha de base em `ruido:<chave>` (é uma medição, não uma aprovação: grava sem `--update-baseline`).
   */
  async measureNoise(
    key: string,
    o: {
      judge: JudgeDef;
      provider: { complete(input: CompleteInput): Promise<CompleteResult> };
      runs: PairRun[];
      spreads: Record<string, number>;
      /** Erros nas amostras do lado A: a medição fica incompleta e não é gravada. */
      errors?: number;
      /** Sem dependências por caso (prompts estruturados): o caso sem mudança é o da mesma versão do prompt. */
      versionId?: string;
    },
  ): Promise<NoiseReport> {
    if (o.errors) this.runs.push({ key: noiseKey(key), scores: {}, incomplete: o.errors });
    const byId = new Map(readApproved(key, this.path).map((a) => [a.exampleId, a]));
    const same = o.runs.filter((r) => {
      const a = byId.get(r.exampleId);
      if (r.error || !a) return false;
      return r.deps || !o.versionId ? !depsChanged(a.deps, r.deps) : a.versionId === o.versionId;
    });
    const outcomes = await Promise.all(
      same.map((r) => this.judgeCase(o, r, byId.get(r.exampleId) as ApprovedCase)),
    );
    const { wins, losses, ties } = tallySamples(outcomes);
    const pairs = wins + losses + ties;
    const report: NoiseReport = {
      key,
      cases: same.length,
      samples: Math.max(1, ...same.map((r) => 1 + (r.samples?.length ?? 0))),
      pairs,
      decisiveRate: pairs ? (wins + losses) / pairs : 0,
      spreads: o.spreads,
      outcomes,
    };
    this.noises.push(report);
    return report;
  }

  /**
   * Pairwise (AV-5) contra a versão aprovada: só com `--gate` ou `--update-baseline` (gasta a assinatura) e só quando a
   * versão do prompt mudou. Sem aprovada, a rodada é a primeira aprovação. Casos com erro ou sem par ficam fora.
   */
  async pairwise(
    key: string,
    o: {
      versionId: string;
      commit: string | null;
      judge: JudgeDef;
      provider: { complete(input: CompleteInput): Promise<CompleteResult> };
      runs: PairRun[];
      features?: FeatureResult[];
      /** Casos novos deste prompt (o `--feature` do comando pode listar casos de vários prompts). */
      feature?: string[];
    },
  ): Promise<PairwiseReport> {
    const report: PairwiseReport = {
      key,
      status: "pulado",
      decision: null,
      cases: [],
      skipped: [],
      features: [],
    };
    const approved = readApproved(key, this.path);
    if (this.flags.seed && !this.flags.gate && !this.flags.update && approved.length > 0)
      return report;
    if (!this.flags.gate && !this.flags.update && !this.flags.seed) return report;
    const ok = o.runs.filter((r) => !r.error);
    const byId = new Map(approved.map((a) => [a.exampleId, a]));
    const fresh = (r: PairRun): ApprovedCase => ({
      exampleId: r.exampleId,
      versionId: o.versionId,
      commit: o.commit,
      approvedAt: nowUtc(),
      output: r.output,
      evaluations: r.evaluations,
      ...(r.deps ? { deps: r.deps } : {}),
    });
    // com as dependências por caso, só o caso que mudou é comparado; o resto mantém a aprovada (gate robusto)
    const perCase = ok.some((r) => r.deps);
    const changed = (r: PairRun) => {
      const a = byId.get(r.exampleId);
      return Boolean(a) && (perCase ? depsChanged(a?.deps, r.deps) : a?.versionId !== o.versionId);
    };
    const pairs = ok.filter(changed);
    report.skipped = ok.filter((r) => byId.has(r.exampleId) && !changed(r)).map((r) => r.exampleId);
    const stage = () => {
      const next = new Map(approved.map((a) => [a.exampleId, a]));
      for (const r of ok) if (!byId.has(r.exampleId) || changed(r)) next.set(r.exampleId, fresh(r));
      this.staged.set(key, [...next.values()]);
    };
    const feature = o.feature ?? this.flags.feature ?? [];
    if (approved.length === 0) {
      report.status = "primeira";
      stage();
    } else if (
      feature.length === 0 &&
      (perCase ? pairs.length === 0 : approved.every((a) => a.versionId === o.versionId))
    ) {
      report.status = "igual";
      // caso novo no dataset entra na aprovada sem pairwise (não tem com quem comparar)
      if (perCase && ok.some((r) => !byId.has(r.exampleId))) stage();
    } else if (feature.length > 0) {
      // não-inferioridade: os antigos afetados não pioram além do ruído; os novos passam
      report.status = "comparado";
      report.cases = await Promise.all(
        pairs.map((r) => this.judgeCase(o, r, byId.get(r.exampleId) as ApprovedCase)),
      );
      const d = pairwiseDecision(report.cases, [], this.margin(key, report.cases), "nao_inferior");
      report.features = o.features ?? [];
      const problems = feature.flatMap((id) => {
        if (byId.has(id)) return [`já tem aprovada: ${id} (--feature é para caso novo)`];
        const f = report.features.find((x) => x.exampleId === id);
        if (!f) return [`não rodou: ${id}`];
        return f.passed ? [] : [`caso novo reprovado: ${id} (${f.detail})`];
      });
      report.decision = problems.length
        ? { ...d, passed: false, reason: [d.reason, ...problems].join("; ") }
        : d;
      if (report.decision.passed || this.flags.ownerApproved) stage();
    } else {
      report.status = "comparado";
      report.cases = await Promise.all(
        pairs.map((r) => this.judgeCase(o, r, byId.get(r.exampleId) as ApprovedCase)),
      );
      const fixes = this.flags.fixes.filter((id) => pairs.some((r) => r.exampleId === id));
      report.decision = pairwiseDecision(report.cases, fixes, this.margin(key, report.cases));
      if (report.decision.passed || this.flags.ownerApproved) stage();
    }
    this.comparisons.push(report);
    return report;
  }

  /**
   * Margem do pairwise pelo ruído por amostra (2026-10-26) e pelo total de pares julgados. A medição antiga (por caso,
   * `decisivos`) não vale para o placar por amostra: sem a nova, margem 1 até rodar o `--noise` de novo.
   */
  private margin(key: string, cases: PairwiseCase[]): number {
    const t = tallySamples(cases);
    return noiseMargin(
      this.baselines[noiseKey(key)]?.scores.decisivos_por_amostra,
      t.wins + t.losses + t.ties,
    );
  }

  /** Imprime o resumo; grava a linha de base nova se pedida e sem regressão. Devolve true se o gate falhou. */
  /** A rodada gravou a linha de base e as aprovadas (`--update-baseline` aprovado): a retomada do gate é apagada. */
  wroteBaseline = false;
  /** A rodada gravou o ruído medido (`--noise` completo). */
  wroteNoise = false;

  finish(log: (line: string) => void = console.log): boolean {
    // rodada com erro do modelo ou sem notas não mede nada: reprova o gate e nunca vira linha de base (2026-10-16:
    // a ponte respondeu 401 e a linha de base saiu vazia)
    const incomplete = this.runs.filter((r) => r.incomplete > 0);
    for (const r of incomplete)
      log(`\n  ✘ ${r.key}: rodada incompleta (${r.incomplete} erro(s) do modelo ou sem notas).`);
    if (this.regressions.length > 0) {
      log(`\nRegressões em relação a ${this.path}:`);
      for (const r of this.regressions)
        log(
          `  ✘ ${r.key} · ${r.evaluator}: ${(r.current * 100).toFixed(0)}% (linha de base ${(r.baseline * 100).toFixed(0)}%)`,
        );
    } else if (this.runs.length > 0) {
      log("\nSem regressão em relação à linha de base.");
    }
    for (const c of this.comparisons) {
      if (c.status === "igual") log(`  = ${c.key}: mesma versão da aprovada, sem pairwise.`);
      else if (c.status === "primeira")
        log(`  + ${c.key}: sem versão aprovada; esta rodada é a primeira aprovação.`);
      else if (c.decision) {
        const d = c.decision;
        log(
          `  ${d.passed ? "✔" : "✘"} ${c.key} · pairwise: ${d.wins} vitórias, ${d.losses} derrotas, ${d.ties} empates (${d.reason})`,
        );
        // com o placar por amostra, um caso empatado na maioria também pesa: mostra todo caso com amostra decidida
        for (const x of c.cases.filter((x) =>
          (x.samples ?? [x.outcome]).some((o) => o !== "empate"),
        ))
          log(
            `      ${x.outcome === "ganhou" ? "+" : x.outcome === "perdeu" ? "-" : "="} ${x.exampleId}: ${x.explanation}`,
          );
      }
    }
    for (const c of this.comparisons)
      for (const f of c.features)
        log(`  ${f.passed ? "✔" : "✘"} ${c.key} · caso novo ${f.exampleId}: ${f.detail}`);
    for (const c of this.comparisons)
      if (c.skipped.length > 0)
        log(
          `  = ${c.key}: sem mudança nas dependências, fora do pairwise: ${c.skipped.join(", ")}.`,
        );
    for (const n of this.noises) {
      const decisive = Math.round(n.decisiveRate * n.pairs);
      log(
        `\nRuído de ${n.key} (A contra A, ${n.cases} casos com ${n.samples} amostra(s)): o acaso decidiu ${decisive} de ${n.pairs} pares (${(n.decisiveRate * 100).toFixed(0)}%); margem do pairwise = ⌈√(taxa · pares julgados)⌉ (10 pares: ${noiseMargin(n.decisiveRate, 10)}; 20 pares: ${noiseMargin(n.decisiveRate, 20)}).`,
      );
      for (const [k, v] of Object.entries(n.spreads))
        log(`  ${k}: as médias variaram ${(v * 100).toFixed(0)} pontos entre as amostras.`);
      for (const x of n.outcomes.filter((x) => x.outcome !== "empate"))
        log(`  ${x.outcome === "ganhou" ? "+" : "-"} ${x.exampleId}: ${x.explanation}`);
    }
    if (this.noises.length > 0 && incomplete.length === 0) {
      for (const n of this.noises)
        this.baselines[noiseKey(n.key)] = {
          scores: {
            amostras: n.samples,
            casos: n.cases,
            pares: n.pairs,
            decisivos_por_amostra: n.decisiveRate,
            ...n.spreads,
          },
          updatedAt: nowUtc(),
        };
      writeFileSync(this.path, serializeBaselines(this.baselines));
      this.wroteNoise = true;
      log(`Ruído gravado em ${this.path}.`);
    }
    const notUpgrade = this.comparisons.filter((c) => c.decision && !c.decision.passed);
    if (this.flags.seed && !this.flags.update) {
      if (incomplete.length > 0)
        log("Versões aprovadas não gravadas: corrija as rodadas incompletas antes.");
      else this.writeStaged(log);
    }
    const blocked = this.regressions.length > 0 || notUpgrade.length > 0;
    const owner = Boolean(this.flags.ownerApproved) && incomplete.length === 0;
    if (this.flags.update && owner && blocked)
      log(
        `Aprovado pelo dono apesar de: ${[
          ...this.regressions.map(
            (r) => `${r.key} · ${r.evaluator} ${(r.current * 100).toFixed(0)}%`,
          ),
          ...notUpgrade.map((c) => `${c.key} sem upgrade`),
        ].join("; ")}.`,
      );
    if (this.flags.update) {
      if (incomplete.length > 0 || (blocked && !owner)) {
        log(
          "Linha de base não atualizada: corrija as regressões, as rodadas incompletas e os prompts que não são upgrade antes.",
        );
      } else {
        this.wroteBaseline = true;
        const next: Baselines = { ...this.baselines };
        for (const r of this.runs)
          next[r.key] = {
            scores: r.scores,
            versionId: r.versionId,
            commit: r.commit,
            updatedAt: nowUtc(),
          };
        if (this.runs.length > 0) {
          writeFileSync(this.path, serializeBaselines(next));
          log(`Linha de base atualizada em ${this.path} (${this.runs.length} entradas).`);
        }
        this.writeStaged(log);
      }
    }
    return this.flags.gate && (incomplete.length > 0 || (blocked && !owner));
  }

  private writeStaged(log: (line: string) => void) {
    for (const [key, cases] of this.staged) {
      const p = approvedPath(key, this.path);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, serializeApproved(cases));
      log(`Versão aprovada de ${key} gravada em ${p} (${cases.length} casos).`);
    }
  }
}
