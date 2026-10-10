import type { SettingsRepo } from "../db/repos/settings";
import { INGEST_SETTING_KEYS } from "../ingest/settings";

/**
 * Aprendizado da conversão % da janela de 5 h → tokens, por modelo (F03-3 §1): compara a utilização antes e
 * depois de uma execução com os tokens gastos. Média móvel (peso 0,3 para a amostra nova); amostras sem variação
 * ou com a janela renovada no meio (utilização caiu) são ignoradas.
 */
export const LEARN_ALPHA = 0.3;

export interface LearnSample {
  model: string;
  utilizationBefore: number;
  utilizationAfter: number;
  tokens: number;
  /** Renovação da janela antes/depois: se mudou, a janela renovou no meio e a amostra é descartada. */
  resetsBefore?: string | null;
  resetsAfter?: string | null;
  /** Outra chamada ao modelo esteve em voo ao mesmo tempo: o delta não é só desta chamada (descartada). */
  overlapped?: boolean;
}

export function learnPctToTokens(
  current: Record<string, number>,
  s: LearnSample,
): Record<string, number> {
  if (s.overlapped) return current;
  if ((s.resetsBefore ?? null) !== (s.resetsAfter ?? null)) return current;
  const delta = s.utilizationAfter - s.utilizationBefore;
  if (delta <= 0 || s.tokens <= 0) return current;
  const sample = s.tokens / delta;
  const prev = current[s.model];
  const next = prev === undefined ? sample : (1 - LEARN_ALPHA) * prev + LEARN_ALPHA * sample;
  return { ...current, [s.model]: Math.round(next) };
}

/** Lê, aprende e grava em `settings.budget.pct_to_tokens`. */
export function recordPctSample(settings: SettingsRepo, s: LearnSample): Record<string, number> {
  const current = settings.get<Record<string, number>>(INGEST_SETTING_KEYS.pctToTokens) ?? {};
  const next = learnPctToTokens(current, s);
  if (next !== current) settings.set(INGEST_SETTING_KEYS.pctToTokens, next);
  return next;
}

/** Janela de 5 h no instante (do último evento de limite do provider; leitura barata, sem chamada). */
export interface PlanWindowSnapshot {
  utilization: number | null;
  resetsAt: string | null;
}

/**
 * Amostragem por chamada (correções da auditoria F03, item 11): lê a janela imediatamente antes e depois de cada
 * chamada ao modelo, atribui ao modelo daquela chamada e marca como concorrente quando outra chamada esteve em voo
 * ao mesmo tempo (no mesmo processo). Erros na chamada não geram amostra; erros de amostragem nunca quebram a chamada.
 */
export function createPlanSampler(o: {
  snapshot: () => PlanWindowSnapshot | null;
  record: (s: LearnSample) => void;
}) {
  let inFlight = 0;
  let starts = 0;
  const safe = <T>(fn: () => T): T | null => {
    try {
      return fn();
    } catch {
      return null;
    }
  };
  return {
    async track<T>(
      model: string,
      fn: () => Promise<T>,
      tokensOf: (result: T) => number,
    ): Promise<T> {
      const before = safe(o.snapshot);
      const startedWith = inFlight;
      inFlight++;
      const seq = ++starts;
      let result: T;
      try {
        result = await fn();
      } finally {
        inFlight--;
      }
      const after = safe(o.snapshot);
      if (typeof before?.utilization === "number" && typeof after?.utilization === "number") {
        const sample: LearnSample = {
          model,
          utilizationBefore: before.utilization,
          utilizationAfter: after.utilization,
          tokens: safe(() => tokensOf(result)) ?? 0,
          resetsBefore: before.resetsAt,
          resetsAfter: after.resetsAt,
          overlapped: startedWith > 0 || starts !== seq,
        };
        safe(() => o.record(sample));
      }
      return result;
    },
  };
}
