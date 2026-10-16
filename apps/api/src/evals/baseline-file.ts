import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Baselines,
  findRegressions,
  parseBaselines,
  type Regression,
  serializeBaselines,
} from "@narnia-jobs/core";
import { nowUtc } from "@narnia-jobs/shared";

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
}

export function gateFlags(args: string[]): GateFlags {
  return { gate: args.includes("--gate"), update: args.includes("--update-baseline") };
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
    if (this.flags.update) {
      if (this.regressions.length > 0 || incomplete.length > 0) {
        log("Linha de base não atualizada: corrija as regressões e as rodadas incompletas antes.");
      } else {
        const next: Baselines = { ...this.baselines };
        for (const r of this.runs)
          next[r.key] = {
            scores: r.scores,
            versionId: r.versionId,
            commit: r.commit,
            updatedAt: nowUtc(),
          };
        writeFileSync(this.path, serializeBaselines(next));
        log(`Linha de base atualizada em ${this.path} (${this.runs.length} entradas).`);
      }
    }
    return this.flags.gate && (this.regressions.length > 0 || incomplete.length > 0);
  }
}
