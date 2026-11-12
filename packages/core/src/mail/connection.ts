import { nowUtc } from "@narnia-jobs/shared";
import {
  buildGmailAuthUrl,
  deleteGmailToken,
  exchangeGmailCode,
  type GoogleClient,
  gmailAccessTokens,
  MailAuthError,
  readGmailToken,
  revokeGmailToken,
  writeGmailToken,
} from "./google-oauth";
import { GMAIL_RATE_LIMIT_MESSAGE, GmailRestSource } from "./source";

/** Etiquetas do narnia no Gmail (pedido do dono e F14-14). */
export const MAIL_LABEL = "narnia-jobs";
export const MAIL_SUSPECT_LABEL = "narnia-jobs/suspeito";

export type GmailConnectionState =
  | "not_configured"
  | "disconnected"
  | "connected"
  | "needs_reconnect";

export interface GmailStatus {
  status: GmailConnectionState;
  email: string | null;
  connectedAt: string | null;
  clientSource: GoogleClient["source"] | null;
  /** Só o começo do client id, para a pessoa reconhecer qual cliente está em uso. */
  clientIdHint: string | null;
  reason: string | null;
}

export function gmailStatus(dataDir: string, client: GoogleClient | null): GmailStatus {
  let token = readGmailToken(dataDir);
  // a versão anterior marcava "reconectar" no 403 de cota do Google (passa sozinho): desfaz a marca
  if (token?.invalidAt && GMAIL_RATE_LIMIT_MESSAGE.test(token.invalidReason ?? "")) {
    token = { ...token, invalidAt: null, invalidReason: null };
    writeGmailToken(dataDir, token);
  }
  const base = {
    clientSource: client?.source ?? null,
    clientIdHint: client ? `${client.clientId.slice(0, 12)}…` : null,
  };
  if (!client)
    return { status: "not_configured", email: null, connectedAt: null, reason: null, ...base };
  if (!token)
    return { status: "disconnected", email: null, connectedAt: null, reason: null, ...base };
  return {
    status: token.invalidAt ? "needs_reconnect" : "connected",
    email: token.email,
    connectedAt: token.connectedAt,
    reason: token.invalidReason ?? null,
    ...base,
  };
}

/** Login em andamento (um por vez): o `state` liga o retorno do Google ao `verifier` do PKCE. */
export interface PendingGmailConnect {
  state: string;
  verifier: string;
  redirectUri: string;
  expiresAt: number;
}

export function startGmailConnect(o: {
  client: GoogleClient;
  redirectUri: string;
  now?: number;
  ttlMs?: number;
}) {
  const start = buildGmailAuthUrl({ clientId: o.client.clientId, redirectUri: o.redirectUri });
  const pending: PendingGmailConnect = {
    state: start.state,
    verifier: start.verifier,
    redirectUri: o.redirectUri,
    expiresAt: (o.now ?? Date.now()) + (o.ttlMs ?? 10 * 60_000),
  };
  return { url: start.url, pending };
}

/**
 * Retorno do Google: confere o `state`, troca o código, lê o e-mail da conta pelo perfil, cria as etiquetas e grava o
 * token. Erros viram `MailAuthError` com mensagem para a pessoa.
 */
export async function finishGmailConnect(o: {
  fetch: typeof fetch;
  dataDir: string;
  client: GoogleClient;
  pending: PendingGmailConnect | null;
  params: URLSearchParams;
  now?: number;
}): Promise<{ email: string }> {
  const err = o.params.get("error");
  if (err)
    throw new MailAuthError(
      "exchange_failed",
      err === "access_denied" ? "Acesso negado no Google" : `Google: ${err}`,
    );
  if (
    !o.pending ||
    o.params.get("state") !== o.pending.state ||
    (o.now ?? Date.now()) > o.pending.expiresAt
  )
    throw new MailAuthError(
      "exchange_failed",
      "Login expirado ou de outra tentativa: clique em Conectar de novo",
    );
  const code = o.params.get("code");
  if (!code) throw new MailAuthError("exchange_failed", "O Google não devolveu o código");
  const t = await exchangeGmailCode({
    fetch: o.fetch,
    client: o.client,
    code,
    verifier: o.pending.verifier,
    redirectUri: o.pending.redirectUri,
  });
  const source = new GmailRestSource({ fetch: o.fetch, accessToken: async () => t.accessToken });
  const profile = await source.profile();
  await source.ensureLabels([MAIL_LABEL, MAIL_SUSPECT_LABEL]);
  writeGmailToken(o.dataDir, {
    refreshToken: t.refreshToken,
    scope: t.scope,
    email: profile.email,
    connectedAt: nowUtc(),
    invalidAt: null,
    invalidReason: null,
  });
  return { email: profile.email };
}

export async function disconnectGmail(o: { fetch: typeof fetch; dataDir: string }): Promise<void> {
  const token = readGmailToken(o.dataDir);
  if (token) await revokeGmailToken(o.fetch, token.refreshToken);
  deleteGmailToken(o.dataDir);
}

/** Fonte do Gmail com o token guardado (worker e api). */
export function gmailSource(o: {
  fetch: typeof fetch;
  dataDir: string;
  client: () => GoogleClient | null;
}) {
  return new GmailRestSource({ fetch: o.fetch, accessToken: gmailAccessTokens(o) });
}
