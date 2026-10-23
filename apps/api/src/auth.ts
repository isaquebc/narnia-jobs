import { randomBytes, timingSafeEqual } from "node:crypto";
import { isDeviceToken } from "@narnia-jobs/core";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { apiError } from "./errors";

export const COOKIE_NAME = "narnia_token";
// `/api/extension/pair` troca o código de pareamento pelo token de dispositivo (F12-9): quem chama ainda não tem token;
// `/api/extension/enter` confere o token de dispositivo da query, como o `/api/auth/enter` (F12/M2)
const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/auth/enter",
  "/api/extension/pair",
  "/api/extension/enter",
]);

export function generateBootToken(): string {
  return randomBytes(24).toString("hex");
}

export function tokenMatches(expected: string, given: string | undefined | null): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Tokens de dispositivo da extensão do navegador (F12-9): valem para a API inteira até serem revogados. */
export interface DeviceAuth {
  find(token: string): { id: string } | null;
  touch(id: string): void;
}

/**
 * Token de boot (decisão F01-7): aceito em `Authorization: Bearer` ou no cookie HttpOnly gravado pela rota de
 * entrada. A query string só vale em `/api/auth/enter`, para a URL impressa no boot. Tokens de dispositivo da extensão
 * (`nxd_…`, F12-9) valem do mesmo jeito.
 */
export function authMiddleware(token: string, devices?: DeviceAuth): MiddlewareHandler {
  return async (c, next) => {
    // o roteador do Hono decodifica o caminho (`/%61pi/x` cai em `/api/x`): a decisão usa o mesmo caminho
    // decodificado, senão o percent-encoding escapava do token (auditoria pós-F04, 2026-10-12)
    const path = decodedPath(new URL(c.req.url).pathname);
    if (path === null) return apiError(c, 400, "bad_path", "Caminho com codificação inválida");
    // /api/* e o servidor MCP (/mcp, F04-7) exigem o token; o resto (SPA, assets) é público
    if (PUBLIC_PATHS.has(path) || !(path.startsWith("/api/") || path === "/mcp")) return next();
    const header = c.req.header("authorization");
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
    // o Bearer vem antes do cookie: a extensão chama com o token dela no mesmo navegador em que o dono tem o cookie,
    // e o uso precisa contar para o dispositivo
    for (const given of [bearer, getCookie(c, COOKIE_NAME)]) {
      if (tokenMatches(token, given)) return next();
      const device = devices ? deviceFor(devices, given) : null;
      if (device) {
        devices?.touch(device.id);
        return next();
      }
      // token de dispositivo revogado no Bearer não cai no cookie do dono: a extensão precisa saber que foi desconectada
      if (given === bearer && given && isDeviceToken(given)) break;
    }
    return apiError(c, 401, "unauthorized", "Token ausente ou inválido");
  };
}

function deviceFor(devices: DeviceAuth, given: string | null | undefined) {
  return given && isDeviceToken(given) ? devices.find(given) : null;
}

function decodedPath(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export function enterHandler(token: string) {
  return (c: Context) => {
    const given = c.req.query("token");
    if (!tokenMatches(token, given)) return apiError(c, 401, "unauthorized", "Token inválido");
    setCookie(c, COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return c.redirect("/", 302);
  };
}
