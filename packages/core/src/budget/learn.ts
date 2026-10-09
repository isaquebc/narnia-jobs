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
}

export function learnPctToTokens(
  current: Record<string, number>,
  s: LearnSample,
): Record<string, number> {
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
