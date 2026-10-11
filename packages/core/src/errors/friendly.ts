/**
 * Mapa único de erros (plano de comunicação C5, 2026-10-11): o texto técnico nasce em quatro lugares (GhError,
 * ProviderError, githubErrorMessage, onStageFailed); aqui ele vira uma chave de mensagem em pt-BR (dicionário da web,
 * `error.*`) e uma dica de ação (`<chave>_hint`). O texto técnico segue junto, para "Detalhes técnicos".
 */
export type FriendlyErrorKey =
  | "error.model_format"
  | "error.github_unstable"
  | "error.interrupted"
  | "error.github_not_connected"
  | "error.github_rate_limited"
  | "error.repo_empty"
  | "error.gh_missing"
  | "error.unknown";

export interface FriendlyError {
  key: FriendlyErrorKey;
  hint: `${FriendlyErrorKey}_hint`;
  technical: string;
}

const BY_CODE: Record<string, FriendlyErrorKey> = {
  structured_output_failed: "error.model_format",
  invalid_output: "error.model_format",
  not_authenticated: "error.github_not_connected",
  rate_limited: "error.github_rate_limited",
  empty: "error.repo_empty",
};

const BY_TEXT: Array<[RegExp, FriendlyErrorKey]> = [
  [
    /maximum number of turns|sem saída estruturada|saída fora do schema|structured_output/i,
    "error.model_format",
  ],
  [/github instável|HTTP 5\d\d/i, "error.github_unstable"],
  [/stalled more than allowable limit|interrompid|sumiu da fila/i, "error.interrupted"],
  [/não conectado|sem autenticação|not_authenticated/i, "error.github_not_connected"],
  [/limite de requisições|rate limit/i, "error.github_rate_limited"],
  [/repositório vazio|repository is empty/i, "error.repo_empty"],
  [/cli indisponível|gh não está instalado|ENOENT/i, "error.gh_missing"],
];

const make = (key: FriendlyErrorKey, technical: string): FriendlyError => ({
  key,
  hint: `${key}_hint`,
  technical,
});

export function friendlyError(
  raw: string | { code?: string | null; message?: string | null } | null | undefined,
): FriendlyError {
  if (raw === null || raw === undefined) return make("error.unknown", "");
  const text = typeof raw === "string" ? raw : (raw.message ?? "");
  if (typeof raw !== "string" && raw.code && BY_CODE[raw.code])
    return make(BY_CODE[raw.code] as FriendlyErrorKey, text);
  for (const [re, key] of BY_TEXT) if (re.test(text)) return make(key, text);
  return make("error.unknown", text);
}
