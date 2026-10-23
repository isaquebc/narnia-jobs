/**
 * Conversa da extensão com o narnia (F12/M1, F12-9): endereço da instância, troca do código de pareamento pelo token
 * de dispositivo e teste da conexão. Sem dependência do Chrome, para os testes.
 */
// o endereço da barra do navegador na instância do dono (web na 5173, que repassa /api)
export const DEFAULT_INSTANCE = "http://127.0.0.1:5173";

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

export type DisconnectResult = { ok: true } | { ok: false; message: string };

/** Desconecta no narnia também: o token de dispositivo vale para a API (F12-9), então ele remove o próprio dispositivo. */
export async function disconnect(
  fetch: Fetch,
  instance: string,
  token: string,
): Promise<DisconnectResult> {
  const headers = { authorization: `Bearer ${token}` };
  try {
    const me = await fetch(`${instance}/api/extension/me`, { headers });
    if (me.status === 401) return { ok: true };
    const id = me.ok
      ? ((await me.json()) as { device: { id: string } | null }).device?.id
      : undefined;
    if (id) {
      const del = await fetch(`${instance}/api/extension/devices/${id}`, {
        method: "DELETE",
        headers,
      });
      if (del.ok || del.status === 404 || del.status === 401) return { ok: true };
    }
  } catch {
    // narnia fora do ar: cai no aviso abaixo
  }
  return {
    ok: false,
    message:
      "Desconectado neste navegador, mas não foi possível avisar o narnia. Remova em Configurações › Extensão do navegador.",
  };
}

/** Entrada da janela popup (F12/M2): o token do dispositivo vira o cookie da web e o narnia redireciona para `next`. */
export function enterUrl(instance: string, token: string, next: string): string {
  return `${instance}/api/extension/enter?device=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;
}

export type CaptureResult =
  | { ok: true; id: string }
  | { ok: false; reason: "offline" | "unauthorized" | "unexpected"; message: string };

/** Manda a aba lida (F12/M2) para o narnia, com o token do dispositivo. */
export async function sendCapture(
  fetch: Fetch,
  instance: string,
  token: string,
  page: { url: string; title: string; html: string },
): Promise<CaptureResult> {
  let res: Response;
  try {
    res = await fetch(`${instance}/api/extension/captures`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "page", ...page }),
    });
  } catch {
    return { ok: false, reason: "offline", message: offlineMessage(instance) };
  }
  if (res.status === 401)
    return {
      ok: false,
      reason: "unauthorized",
      message: "Este navegador foi desconectado no narnia. Abra as opções e pareie de novo.",
    };
  const body = (await res.json().catch(() => ({}))) as { id?: string };
  if (res.ok && body.id) return { ok: true, id: body.id };
  return { ok: false, reason: "unexpected", message: `O narnia respondeu ${res.status}.` };
}
