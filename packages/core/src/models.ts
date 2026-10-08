import type { SettingsRepo } from "./db/repos/settings";
import type { DetectedLanguage } from "./extract/language";

/** Modelos por tarefa (decisão F01-5): fatos com Haiku, digest com Sonnet, leitura do documento com Haiku. */
export interface ExtractionModels {
  document: string;
  facts: string;
  digest: string;
}

export const DEFAULT_EXTRACTION_MODELS: ExtractionModels = {
  document: "haiku",
  facts: "haiku",
  digest: "sonnet",
};

interface ModelsSetting {
  extraction?: Partial<ExtractionModels>;
}

/** Lê `settings.models.extraction` e completa com os padrões. */
export function resolveExtractionModels(settings: SettingsRepo): ExtractionModels {
  const stored = settings.get<ModelsSetting>("models")?.extraction ?? {};
  const defined = Object.fromEntries(
    Object.entries(stored).filter(([, v]) => typeof v === "string" && v.length > 0),
  ) as Partial<ExtractionModels>;
  return { ...DEFAULT_EXTRACTION_MODELS, ...defined };
}

/** Locale dos prompts/documentos a partir do idioma detectado no texto. */
export function localeFromLanguage(language: DetectedLanguage | string): string {
  if (language === "en") return "en-US";
  return "pt-BR";
}
