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
  | "error.auth_expired"
  | "error.turn_in_progress"
  | "error.budget_exhausted"
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
  turn_in_progress: "error.turn_in_progress",
  budget_exhausted: "error.budget_exhausted",
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
  [
    /OAuth session expired|could not be refreshed|Failed to authenticate|authentication_error|Please run \/login/i,
    "error.auth_expired",
  ],
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

type Messages = Record<FriendlyErrorKey | `${FriendlyErrorKey}_hint`, string>;

/**
 * Textos em pt-BR do mapa (auditoria D): a api usa nos erros de tool do `/mcp` (o modelo lê) e a web tem o mesmo texto
 * no dicionário `error.*` (um teste da web garante que não divergem).
 */
export const FRIENDLY_MESSAGES: Messages = {
  "error.model_format": "O modelo não concluiu a resposta no formato esperado.",
  "error.model_format_hint": "Tente de novo; se repetir, troque o modelo.",
  "error.github_unstable": "O GitHub está instável agora (tentamos 3 vezes).",
  "error.github_unstable_hint": "Tente de novo em alguns minutos.",
  "error.interrupted": "A tarefa foi interrompida porque o serviço reiniciou.",
  "error.interrupted_hint": "Refaça esta etapa.",
  "error.github_not_connected": "O GitHub não está conectado.",
  "error.github_not_connected_hint": "Conecte o GitHub em Configurações › Integrações.",
  "error.github_rate_limited": "Limite de requisições do GitHub atingido.",
  "error.github_rate_limited_hint": "Tente de novo mais tarde ou conecte sua conta do GitHub.",
  "error.repo_empty": "Repositório sem nenhum commit; foi pulado.",
  "error.repo_empty_hint": "Nada a fazer.",
  "error.gh_missing": "O GitHub CLI não está disponível no serviço.",
  "error.gh_missing_hint": "Reconstrua a stack com make dev-down && make dev.",
  "error.auth_expired": "O login da assinatura expirou e não pôde ser renovado.",
  "error.auth_expired_hint":
    "Refaça com ./start.sh login. Para não expirar de novo, gere um token com claude setup-token, defina CLAUDE_CODE_OAUTH_TOKEN no .env e reinicie.",
  "error.turn_in_progress": "O recrutador ainda está respondendo a mensagem anterior.",
  "error.turn_in_progress_hint": "Espere a resposta terminar ou clique em Parar.",
  "error.budget_exhausted": "Esta conversa atingiu o teto de custo.",
  "error.budget_exhausted_hint":
    "Abra uma conversa nova ou aumente o teto em Configurações › Chat.",
  "error.unknown": "Algo deu errado nesta etapa.",
  "error.unknown_hint": "Tente de novo.",
};

/** Mensagem e dica em pt-BR de um erro já classificado. */
export function friendlyText(f: FriendlyError): { text: string; hint: string } {
  return { text: FRIENDLY_MESSAGES[f.key], hint: FRIENDLY_MESSAGES[f.hint] };
}
