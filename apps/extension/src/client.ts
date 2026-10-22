/**
 * Conversa da extensão com o narnia (F12/M1, F12-9): endereço da instância, troca do código de pareamento pelo token
 * de dispositivo e teste da conexão. Sem dependência do Chrome, para os testes.
 */
export const DEFAULT_INSTANCE = "http://127.0.0.1:3100";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Hosts além do computador: só no build do e2e (`NARNIA_EXTENSION_EXTRA_HOSTS=web`); vazio no build normal. */
declare const __NARNIA_EXTRA_HOSTS__: string[];
const EXTRA_HOSTS: string[] =
  typeof __NARNIA_EXTRA_HOSTS__ === "undefined" ? [] : __NARNIA_EXTRA_HOSTS__;

/** Aceita o que a pessoa cola ("127.0.0.1:5173", com barra no fim…); só http(s) local. */
export function normalizeInstanceUrl(input: string, extraHosts = EXTRA_HOSTS): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!["127.0.0.1", "localhost", "[::1]", ...extraHosts].includes(url.hostname)) return null;
  return url.origin;
}

export type PairResult =
  | { ok: true; token: string; deviceName: string }
  | {
      ok: false;
      reason: "invalid_code" | "too_many_attempts" | "offline" | "unexpected";
      message: string;
    };

export async function pairWithCode(
  fetch: Fetch,
  instance: string,
  code: string,
  name: string,
): Promise<PairResult> {
  let res: Response;
  try {
    res = await fetch(`${instance}/api/extension/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name }),
    });
  } catch {
    return { ok: false, reason: "offline", message: offlineMessage(instance) };
  }
  const body = (await res.json().catch(() => ({}))) as {
    token?: string;
    device?: { name?: string };
    error?: { code?: string; message?: string };
  };
  if (res.ok && body.token)
    return { ok: true, token: body.token, deviceName: body.device?.name ?? name };
  const reason =
    body.error?.code === "invalid_code" || body.error?.code === "too_many_attempts"
      ? body.error.code
      : "unexpected";
  return { ok: false, reason, message: body.error?.message ?? `O narnia respondeu ${res.status}.` };
}

export type ConnectionResult =
  | { ok: true; deviceName: string | null; version: string }
  | { ok: false; reason: "offline" | "unauthorized" | "unexpected"; message: string };

export async function testConnection(
  fetch: Fetch,
  instance: string,
  token: string,
): Promise<ConnectionResult> {
  let res: Response;
  try {
    res = await fetch(`${instance}/api/extension/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, reason: "offline", message: offlineMessage(instance) };
  }
  if (res.status === 401)
    return {
      ok: false,
      reason: "unauthorized",
      message:
        "Este dispositivo foi desconectado no narnia. Gere um código novo em Configurações e pareie de novo.",
    };
  if (!res.ok)
    return { ok: false, reason: "unexpected", message: `O narnia respondeu ${res.status}.` };
  const body = (await res.json()) as { device: { name: string } | null; version: string };
  return { ok: true, deviceName: body.device?.name ?? null, version: body.version };
}

const offlineMessage = (instance: string) =>
  `Não foi possível conectar a ${instance}. Confira se o narnia está no ar e se o endereço é o da barra do navegador quando você abre o narnia.`;
