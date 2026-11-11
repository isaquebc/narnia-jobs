import { createHash, randomBytes } from "node:crypto";
import { deleteSecret, readSecret, writeSecret } from "../secrets";

/**
 * OAuth do Google para o Gmail (F14-4, §2.0.3): cliente da própria pessoa (Aplicativo da Web), escopo `gmail.modify`
 * (lê, etiqueta e marca como lido; não envia nem apaga), PKCE e `access_type=offline`. O cliente vem do ambiente
 * (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) ou do cartão de Configurações; o refresh token fica em
 * `<dados>/secrets/gmail-token.json` e nunca volta em resposta.
 */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_CLIENT_SECRET_NAME = "google-oauth-client";
export const GMAIL_TOKEN_SECRET_NAME = "gmail-token";

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
  source: "env" | "settings";
}

export interface GmailToken {
  refreshToken: string;
  scope: string;
  email: string;
  connectedAt: string;
  /** Preenchido quando o Google recusou o refresh (expirou ou foi revogado): pede reconectar. */
  invalidAt?: string | null;
  invalidReason?: string | null;
}

export class MailAuthError extends Error {
  constructor(
    readonly code: "not_configured" | "not_connected" | "needs_reconnect" | "exchange_failed",
    message: string,
  ) {
    super(message);
    this.name = "MailAuthError";
  }
}

/** Cliente OAuth: o do ambiente vence; sem ele, o salvo em Configurações. */
export function resolveGoogleClient(
  env: Record<string, string | undefined>,
  dataDir: string,
): GoogleClient | null {
  const id = env.GOOGLE_CLIENT_ID?.trim();
  const secret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (id && secret) return { clientId: id, clientSecret: secret, source: "env" };
  const saved = readSecret<{ clientId: string; clientSecret: string }>(
    dataDir,
    GOOGLE_CLIENT_SECRET_NAME,
  );
  return saved?.clientId && saved.clientSecret ? { ...saved, source: "settings" } : null;
}

export function saveGoogleClient(
  dataDir: string,
  c: { clientId: string; clientSecret: string },
): void {
  writeSecret(dataDir, GOOGLE_CLIENT_SECRET_NAME, {
    clientId: c.clientId.trim(),
    clientSecret: c.clientSecret.trim(),
  });
}

export function deleteGoogleClient(dataDir: string): void {
  deleteSecret(dataDir, GOOGLE_CLIENT_SECRET_NAME);
}

export const readGmailToken = (dataDir: string) =>
  readSecret<GmailToken>(dataDir, GMAIL_TOKEN_SECRET_NAME);
export const writeGmailToken = (dataDir: string, t: GmailToken) =>
  writeSecret(dataDir, GMAIL_TOKEN_SECRET_NAME, t);
export const deleteGmailToken = (dataDir: string) => deleteSecret(dataDir, GMAIL_TOKEN_SECRET_NAME);

/** Porta do callback (NARNIA_OAUTH_PORT; 8089 sem valor válido), a mesma no host e no container. */
export function oauthCallbackPort(env: Record<string, string | undefined>): number {
  const port = Number(env.NARNIA_OAUTH_PORT);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 8089;
}

export const oauthRedirectUri = (port: number) => `http://localhost:${port}/callback`;

export interface PkceStart {
  state: string;
  verifier: string;
  url: string;
}

export function buildGmailAuthUrl(o: {
  clientId: string;
  redirectUri: string;
  loginHint?: string;
}): PkceStart {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(16).toString("hex");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = `${GOOGLE_AUTH_URL}?${new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(o.loginHint ? { login_hint: o.loginHint } : {}),
  })}`;
  return { state, verifier, url };
}

async function tokenCall(fetchImpl: typeof fetch, params: Record<string, string>) {
  const r = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok, body };
}

/** Troca o código do retorno pelo refresh token. */
export async function exchangeGmailCode(o: {
  fetch: typeof fetch;
  client: GoogleClient;
  code: string;
  verifier: string;
  redirectUri: string;
}): Promise<{ refreshToken: string; accessToken: string; scope: string; expiresIn: number }> {
  const { ok, body } = await tokenCall(o.fetch, {
    code: o.code,
    client_id: o.client.clientId,
    client_secret: o.client.clientSecret,
    redirect_uri: o.redirectUri,
    grant_type: "authorization_code",
    code_verifier: o.verifier,
  });
  if (!ok || typeof body.refresh_token !== "string")
    throw new MailAuthError(
      "exchange_failed",
      `O Google recusou a autorização (${String(body.error ?? "sem refresh token")})`,
    );
  const scope = String(body.scope ?? "");
  if (!scope.split(/\s+/).includes(GMAIL_SCOPE))
    throw new MailAuthError(
      "exchange_failed",
      "A permissão do Gmail não foi concedida (marque a caixa no login)",
    );
  return {
    refreshToken: body.refresh_token,
    accessToken: String(body.access_token ?? ""),
    scope,
    expiresIn: Number(body.expires_in ?? 3600),
  };
}

export async function revokeGmailToken(
  fetchImpl: typeof fetch,
  refreshToken: string,
): Promise<void> {
  await fetchImpl(`${GOOGLE_REVOKE_URL}?${new URLSearchParams({ token: refreshToken })}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  }).catch(() => null);
}

/**
 * Token de acesso a partir do refresh guardado, com cache até perto de expirar. Recusa do Google (`invalid_grant`)
 * marca o token como inválido (o status vira "reconectar") e lança `needs_reconnect`.
 */
export function gmailAccessTokens(o: {
  fetch: typeof fetch;
  dataDir: string;
  client: () => GoogleClient | null;
  now?: () => number;
}) {
  const now = o.now ?? (() => Date.now());
  let cached: { token: string; until: number } | null = null;
  return async (): Promise<string> => {
    if (cached && cached.until > now()) return cached.token;
    const client = o.client();
    if (!client)
      throw new MailAuthError("not_configured", "Cliente OAuth do Google não configurado");
    const saved = readGmailToken(o.dataDir);
    if (!saved) throw new MailAuthError("not_connected", "Gmail não conectado");
    if (saved.invalidAt) throw new MailAuthError("needs_reconnect", "Conecte o Gmail de novo");
    const { ok, body } = await tokenCall(o.fetch, {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: saved.refreshToken,
      grant_type: "refresh_token",
    });
    if (!ok || typeof body.access_token !== "string") {
      if (body.error === "invalid_grant" || body.error === "unauthorized_client") {
        writeGmailToken(o.dataDir, {
          ...saved,
          invalidAt: new Date(now()).toISOString(),
          invalidReason: String(body.error_description ?? body.error),
        });
        throw new MailAuthError(
          "needs_reconnect",
          "O Google recusou o acesso: conecte o Gmail de novo",
        );
      }
      throw new Error(`Falha ao renovar o acesso ao Gmail (${String(body.error ?? "erro")})`);
    }
    cached = {
      token: body.access_token,
      until: now() + (Number(body.expires_in ?? 3600) - 60) * 1000,
    };
    return body.access_token;
  };
}
