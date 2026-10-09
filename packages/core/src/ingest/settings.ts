import type { BudgetUnit, IngestionDepth } from "@narnia-jobs/shared";
import type { SettingsRepo } from "../db/repos/settings";

/**
 * Preferências da ingestão (F03 §3 `settings`), com os padrões decididos pelo dono. Cada chave pode ser sobrescrita
 * em Configurações; ausente = padrão. Credencial do GitHub nunca vive aqui (só no volume `gh-auth`).
 */
export interface IngestSettings {
  /** F03-1: reusar o `gh` do computador (`host`) ou login próprio do app (`app`). */
  githubAuth: "host" | "app";
  /** F03-3 §1: orçamento padrão por profundidade, em tokens. */
  budgetDefaults: Record<IngestionDepth, number>;
  budgetUnit: BudgetUnit;
  /** Conversão aprendida % da janela → tokens, por modelo (F03-3 §1). */
  pctToTokens: Record<string, number>;
  /** F03-3 §8: camada 2 do revisor anti-alucinação (modelo mais barato). */
  reviewCheckModelEnabled: boolean;
  /** F03-13: CV/texto abaixo disto seguem sem confirmação; 0 = sempre confirmar. GitHub sempre confirma. */
  autoConfirmBelow: number;
  /** F03-9: teto de snapshots (bytes). */
  snapshotsMaxBytes: number;
}

export const DEFAULT_INGEST_SETTINGS: IngestSettings = {
  githubAuth: "host",
  budgetDefaults: { quick: 15_000, balanced: 50_000, deep: 150_000 },
  budgetUnit: "thousand",
  pctToTokens: {},
  reviewCheckModelEnabled: true,
  autoConfirmBelow: 10_000,
  snapshotsMaxBytes: 2 * 1024 ** 3,
};

export const INGEST_SETTING_KEYS = {
  githubAuth: "github.auth",
  budgetDefaults: "budget.default",
  budgetUnit: "budget.unit",
  pctToTokens: "budget.pct_to_tokens",
  reviewCheckModelEnabled: "ingest.review_check_model_enabled",
  autoConfirmBelow: "ingest.auto_confirm_below",
  snapshotsMaxBytes: "snapshots.max_bytes",
} as const satisfies Record<keyof IngestSettings, string>;

export function resolveIngestSettings(settings: SettingsRepo): IngestSettings {
  const out = { ...DEFAULT_INGEST_SETTINGS } as Record<keyof IngestSettings, unknown>;
  for (const [field, key] of Object.entries(INGEST_SETTING_KEYS) as Array<
    [keyof IngestSettings, string]
  >) {
    const value = settings.get(key);
    if (value === undefined) continue;
    const def = DEFAULT_INGEST_SETTINGS[field];
    out[field] =
      typeof def === "object" && def !== null && typeof value === "object" && value !== null
        ? { ...(def as object), ...(value as object) }
        : value;
  }
  return out as unknown as IngestSettings;
}

export interface IngestModels {
  /** Escolha de arquivos na profunda: sempre o mais barato. */
  pick: string;
  repo: string;
  synthesis: string;
  /** Revisor anti-alucinação: sempre o mais barato. */
  check: string;
}

export const CHEAPEST_MODEL = "haiku";

/**
 * Modelos por profundidade (F03-5): rápida/equilibrada Haiku em tudo; profunda Haiku por repositório e Sonnet na
 * síntese. `chosen` (escolha do usuário antes de rodar) substitui repositório e síntese; escolha de arquivos e
 * revisor ficam sempre no mais barato. `settings.models.ingest` sobrescreve os padrões.
 */
export function ingestModelsForDepth(
  settings: SettingsRepo,
  depth: IngestionDepth,
  chosen?: string,
): IngestModels {
  const base: IngestModels = {
    pick: CHEAPEST_MODEL,
    repo: CHEAPEST_MODEL,
    synthesis: depth === "deep" ? "sonnet" : CHEAPEST_MODEL,
    check: CHEAPEST_MODEL,
  };
  const overrides = settings.get<{ ingest?: Partial<IngestModels> }>("models")?.ingest ?? {};
  const merged = { ...base, ...overrides };
  return chosen ? { ...merged, repo: chosen, synthesis: chosen } : merged;
}
