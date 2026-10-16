import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Anti-SSRF (F06 §2.2, movido do api na F05): só http(s), sem credenciais, sem localhost e sem endereço de rede
 * interna depois da resolução de DNS. Usado pela busca de vaga por URL, pelo navegador headless (cada requisição) e
 * pela checagem dos links do CV no worker (F05-19/F05-23).
 */
export type DnsLookup = (host: string) => Promise<string[]>;
export type UrlGuard = (url: URL) => Promise<string | null>;

export const UNRESOLVED_HOST = "Não consegui resolver o endereço.";

/** Endereço que não pode ser buscado a partir do servidor (rede interna, loopback, link-local, multicast). */
export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isBlockedAddress(mapped[1] as string);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s);
  }
  return true;
}

export async function defaultDnsLookup(host: string): Promise<string[]> {
  return (await dnsLookup(host, { all: true })).map((a) => a.address);
}

/** Endereço permitido? null = sim; texto = motivo da recusa. */
export function urlGuard(lookup: DnsLookup = defaultDnsLookup): UrlGuard {
  return async (url) => {
    if (url.protocol !== "http:" && url.protocol !== "https:") return "Só endereços http(s).";
    if (url.username || url.password) return "Endereço com credenciais não é aceito.";
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost")) return "Endereço local não é aceito.";
    let addresses: string[];
    try {
      addresses = isIP(host) ? [host] : await lookup(host);
    } catch {
      return UNRESOLVED_HOST;
    }
    if (addresses.length === 0 || addresses.some(isBlockedAddress))
      return "Endereço de rede interna não é aceito.";
    return null;
  };
}
