import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CompleteInput, CompleteResult } from "@narnia-jobs/providers";
import type { EvalCaseReport } from "./run";

/**
 * Retomada do gate do chat (pedido do dono, 2026-10-28): o limite de uso da assinatura derrubou três rodadas de ~4 h no
 * meio, e nada era aproveitado. Cada conversa terminada (por amostra e caso) e cada chamada ao juiz (absoluto e pairwise,
 * pela entrada exata) vão para um arquivo assim que terminam; a rodada seguinte com a mesma chave (prompts, casos,
 * aprovadas, juízes e opções) retoma de onde parou. Conversa com erro não fica: roda de novo.
 */
interface CheckpointFile {
  key: string;
  runs: Record<string, EvalCaseReport>;
  completions: Record<string, CompleteResult>;
  /** Outros resultados terminados (experimento de um prompt estruturado no Phoenix, por lado). */
  values?: Record<string, unknown>;
}

type Completer = { complete(input: CompleteInput): Promise<CompleteResult> };

export interface Checkpoint {
  /** O que veio do arquivo ao abrir (para avisar que retomou). */
  readonly resumed: { runs: number; completions: number; values: number };
  getRun(slot: string): EvalCaseReport | undefined;
  putRun(slot: string, report: EvalCaseReport): void;
  getValue<T>(slot: string): T | undefined;
  /** Quem chama só guarda o que terminou sem erro. */
  putValue(slot: string, value: unknown): void;
  /** O provider do juiz com memória: a mesma entrada devolve o julgamento guardado. */
  memo<P extends Completer>(provider: P): P;
  clear(): void;
}

/** Erro do limite da assinatura (Claude Code: "You've hit your usage limit", "…your session limit · resets 7:10pm"). */
export const isUsageLimit = (message: string) =>
  /(usage|session|weekly) limit|hit your limit|rate.?limit/i.test(message);

export const checkpointKey = (parts: unknown[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");

export function openCheckpoint(path: string, key: string, o: { fresh?: boolean } = {}): Checkpoint {
  let data: CheckpointFile = { key, runs: {}, completions: {} };
  if (!o.fresh && existsSync(path)) {
    try {
      const saved = JSON.parse(readFileSync(path, "utf8")) as CheckpointFile;
      if (saved.key === key) data = saved;
    } catch {
      // arquivo cortado (processo morto no meio da escrita): começa do zero
    }
  }
  const resumed = {
    runs: Object.keys(data.runs).length,
    completions: Object.keys(data.completions).length,
    values: Object.keys(data.values ?? {}).length,
  };
  const save = () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(data));
    renameSync(`${path}.tmp`, path);
  };
  const hash = (input: CompleteInput) =>
    createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return {
    resumed,
    getRun: (slot) => data.runs[slot],
    putRun(slot, report) {
      if (report.error) return;
      data.runs[slot] = report;
      save();
    },
    getValue: <T>(slot: string) => data.values?.[slot] as T | undefined,
    putValue(slot, value) {
      data.values = { ...data.values, [slot]: value };
      save();
    },
    memo<P extends Completer>(provider: P): P {
      const complete = async (input: CompleteInput) => {
        const h = hash(input);
        const hit = data.completions[h];
        if (hit) return hit;
        const r = await provider.complete(input);
        data.completions[h] = r;
        save();
        return r;
      };
      return new Proxy(provider, {
        get: (target, prop, receiver) =>
          prop === "complete" ? complete : Reflect.get(target, prop, receiver),
      });
    },
    clear() {
      rmSync(path, { force: true });
    },
  };
}

/** Chamadas simultâneas ao juiz (limite de taxa da assinatura, 2026-10-28). */
export const JUDGE_CONCURRENCY = 4;

/**
 * No máximo `n` chamadas ao juiz ao mesmo tempo (2026-10-28): o pairwise julga casos × amostras × 2 ordens de uma vez
 * (~150 processos do Claude Code), e o limite de taxa da assinatura respondia "usage limit" com a cota em 45%.
 */
export function limitConcurrency<P extends Completer>(provider: P, n: number): P {
  let running = 0;
  const waiting: Array<() => void> = [];
  const complete = async (input: CompleteInput) => {
    if (running >= n) await new Promise<void>((resolve) => waiting.push(resolve));
    running++;
    try {
      return await provider.complete(input);
    } finally {
      running--;
      waiting.shift()?.();
    }
  };
  return new Proxy(provider, {
    get: (target, prop, receiver) =>
      prop === "complete" ? complete : Reflect.get(target, prop, receiver),
  });
}
