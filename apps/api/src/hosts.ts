import type { MiddlewareHandler } from "hono";
import { apiError } from "./errors";

/**
 * Proteção contra DNS rebinding (auditoria pós-F04, 2026-10-12): um site malicioso pode apontar o próprio domínio para
 * 127.0.0.1 e falar com o api pelo navegador do usuário; o navegador manda o `Host` do site, então só aceitamos os
 * nomes desta instalação. Hosts internos do compose (`api`, `web`) são de um só rótulo, impossíveis de registrar.
 */
const DEFAULT_HOSTS = ["localhost", "127.0.0.1", "::1", "api", "web"];

export function allowedHostsFromEnv(env: Record<string, string | undefined>): Set<string> {
  const hosts = new Set(DEFAULT_HOSTS);
  if (env.NARNIA_PUBLIC_URL) {
    try {
      hosts.add(bareHost(new URL(env.NARNIA_PUBLIC_URL).host));
    } catch {
      // URL pública malformada: fica só com os padrões
    }
  }
  for (const h of (env.NARNIA_ALLOWED_HOSTS ?? "").split(","))
    if (h.trim()) hosts.add(bareHost(h.trim()));
  return hosts;
}

/** `Host` sem porta e em minúsculas; IPv6 sem colchetes. */
function bareHost(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]"));
  return h.replace(/:\d+$/, "");
}

/** Sem `Host` não há navegador (HTTP/1.0, chamadas em memória dos testes): nada a proteger contra rebinding. */
export function hostAllowed(host: string | undefined | null, allowed: Set<string>): boolean {
  if (!host) return true;
  return allowed.has(bareHost(host));
}

export function hostGuard(allowed: Set<string>): MiddlewareHandler {
  return async (c, next) => {
    if (hostAllowed(c.req.header("host"), allowed)) return next();
    return apiError(
      c,
      403,
      "forbidden_host",
      "Host não permitido. Acesse pelo endereço local ou inclua o host em NARNIA_ALLOWED_HOSTS.",
    );
  };
}
