/**
 * Bloqueador de regressão das avaliações (F06-14, F06-16): cada prompt (ou caso do chat) guarda a nota média por
 * avaliador da última rodada aceita em `evals/baselines.json`, versionado no git. Uma rodada nova regride quando algum
 * avaliador fica abaixo da linha de base menos a tolerância; avaliador novo não regride (entra na próxima atualização)
 * e avaliador que sumiu também não. A linha de base só muda com `--update-baseline`, depois de uma rodada sem regressão.
 */
export interface BaselineEntry {
  scores: Record<string, number>;
  /** Versão do prompt (hash do catálogo) e commit da rodada aceita. */
  versionId?: string | undefined;
  commit?: string | undefined;
  updatedAt: string;
}

export type Baselines = Record<string, BaselineEntry>;

export interface Regression {
  key: string;
  evaluator: string;
  baseline: number;
  current: number;
}

export const BASELINE_TOLERANCE = 0.05;

export function parseBaselines(text: string | null): Baselines {
  if (!text?.trim()) return {};
  const raw = JSON.parse(text) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Baselines = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    const e = v as Partial<BaselineEntry>;
    if (!e || typeof e !== "object" || !e.scores || typeof e.scores !== "object") continue;
    const scores: Record<string, number> = {};
    for (const [name, n] of Object.entries(e.scores)) if (typeof n === "number") scores[name] = n;
    out[key] = {
      scores,
      versionId: e.versionId,
      commit: e.commit,
      updatedAt: String(e.updatedAt ?? ""),
    };
  }
  return out;
}

export function findRegressions(
  baselines: Baselines,
  key: string,
  current: Record<string, number>,
  tolerance = BASELINE_TOLERANCE,
): Regression[] {
  const base = baselines[key];
  if (!base) return [];
  const out: Regression[] = [];
  for (const [evaluator, before] of Object.entries(base.scores)) {
    const now = current[evaluator];
    if (now === undefined) continue;
    if (now < before - tolerance - 1e-9)
      out.push({ key, evaluator, baseline: before, current: now });
  }
  return out;
}

/** Arquivo estável (chaves ordenadas) para o diff do git mostrar só o que mudou. */
export function serializeBaselines(b: Baselines): string {
  const sorted: Baselines = {};
  for (const k of Object.keys(b).sort()) {
    const e = b[k] as BaselineEntry;
    const scores: Record<string, number> = {};
    for (const s of Object.keys(e.scores).sort())
      scores[s] = Math.round((e.scores[s] as number) * 1000) / 1000;
    sorted[k] = {
      scores,
      ...(e.versionId ? { versionId: e.versionId } : {}),
      ...(e.commit ? { commit: e.commit } : {}),
      updatedAt: e.updatedAt,
    };
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}
