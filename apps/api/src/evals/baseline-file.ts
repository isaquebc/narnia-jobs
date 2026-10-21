import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ApprovedCase,
  type ApprovedEvaluation,
  type Baselines,
  findRegressions,
  type PairwiseCase,
  type PairwiseDecision,
  pairwiseDecision,
  parseApproved,
  parseBaselines,
  type Regression,
  serializeApproved,
  serializeBaselines,
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
}

export function gateFlags(args: string[]): GateFlags {
  const fixes = args.find((a) => a.startsWith("--fixes="))?.slice("--fixes=".length) ?? "";
  return {
    gate: args.includes("--gate"),
    update: args.includes("--update-baseline"),
    fixes: fixes.split(",").filter(Boolean),
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
}

export interface PairwiseReport {
  key: string;
  /** pulado: sem --gate/--update-baseline; igual: versão já aprovada; primeira: sem aprovada; comparado: placar. */
  status: "pulado" | "igual" | "primeira" | "comparado";
  decision: PairwiseDecision | null;
  cases: PairwiseCase[];
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
    meta: { versionId?: string; commit?: string; gate?: boolean; errors?: number } = {},
  ): Regression[] {
    const found = meta.gate === false ? [] : findRegressions(this.baselines, key, scores);
    this.regressions.push(...found);
    const incomplete = (meta.errors ?? 0) + (Object.keys(scores).length === 0 ? 1 : 0);
    this.runs.push({ key, scores, versionId: meta.versionId, commit: meta.commit, incomplete });
    return found;
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
    },
  ): Promise<PairwiseReport> {
    const report: PairwiseReport = { key, status: "pulado", decision: null, cases: [] };
    if (!this.flags.gate && !this.flags.update) return report;
    const approved = readApproved(key, this.path);
    const ok = o.runs.filter((r) => !r.error);
    const stage = () =>
      this.staged.set(
        key,
        ok.map((r) => ({
          exampleId: r.exampleId,
          versionId: o.versionId,
          commit: o.commit,
          approvedAt: nowUtc(),
          output: r.output,
          evaluations: r.evaluations,
        })),
      );
    if (approved.length > 0 && approved.every((a) => a.versionId === o.versionId)) {
      report.status = "igual";
    } else if (approved.length === 0) {
      report.status = "primeira";
      stage();
    } else {
      report.status = "comparado";
      const byId = new Map(approved.map((a) => [a.exampleId, a]));
      const pairs = ok.filter((r) => byId.has(r.exampleId));
      report.cases = await Promise.all(
        pairs.map(async (r) => ({
          exampleId: r.exampleId,
          ...(await judgePair(o.provider, o.judge, r.ctx, {
            approved: byId.get(r.exampleId)?.output,
            candidate: r.output,
          })),
        })),
      );
      const fixes = this.flags.fixes.filter((id) => pairs.some((r) => r.exampleId === id));
      report.decision = pairwiseDecision(report.cases, fixes);
      if (report.decision.passed) stage();
    }
    this.comparisons.push(report);
    return report;
  }

  /** Imprime o resumo; grava a linha de base nova se pedida e sem regressão. Devolve true se o gate falhou. */
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
        for (const x of c.cases.filter((x) => x.outcome !== "empate"))
          log(`      ${x.outcome === "ganhou" ? "+" : "-"} ${x.exampleId}: ${x.explanation}`);
      }
    }
    const notUpgrade = this.comparisons.filter((c) => c.decision && !c.decision.passed);
    if (this.flags.update) {
      if (this.regressions.length > 0 || incomplete.length > 0 || notUpgrade.length > 0) {
        log(
          "Linha de base não atualizada: corrija as regressões, as rodadas incompletas e os prompts que não são upgrade antes.",
        );
      } else {
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
        for (const [key, cases] of this.staged) {
          const p = approvedPath(key, this.path);
          mkdirSync(dirname(p), { recursive: true });
          writeFileSync(p, serializeApproved(cases));
          log(`Versão aprovada de ${key} gravada em ${p} (${cases.length} casos).`);
        }
      }
    }
    return (
      this.flags.gate &&
      (this.regressions.length > 0 || incomplete.length > 0 || notUpgrade.length > 0)
    );
  }
}
