import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { apiError } from "./errors";

export const COOKIE_NAME = "narnia_token";
const PUBLIC_PATHS = new Set(["/api/health", "/api/auth/enter"]);

export function generateBootToken(): string {
  return randomBytes(24).toString("hex");
}

export function tokenMatches(expected: string, given: string | undefined | null): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Token de boot (decisão F01-7): aceito em `Authorization: Bearer` ou no cookie HttpOnly gravado pela rota de
 * entrada. A query string só vale em `/api/auth/enter`, para a URL impressa no boot.
 */
export function authMiddleware(token: string): MiddlewareHandler {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    // /api/* e o servidor MCP (/mcp, F04-7) exigem o token; o resto (SPA, assets) é público
    if (PUBLIC_PATHS.has(path) || !(path.startsWith("/api/") || path === "/mcp")) return next();
    const header = c.req.header("authorization");
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (tokenMatches(token, bearer) || tokenMatches(token, getCookie(c, COOKIE_NAME)))
      return next();
    return apiError(c, 401, "unauthorized", "Token ausente ou inválido");
  };
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
