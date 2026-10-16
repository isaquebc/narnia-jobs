import { type DnsLookup, defaultDnsLookup, UNRESOLVED_HOST, urlGuard } from "../net/guard";

/**
 * O link do CV funciona? (F05-13, regra F05-23): `mailto:` e WhatsApp pelo formato; http(s) com o anti-SSRF a cada
 * redirecionamento, e basta o domínio existir e a página não responder 404/410. Bloqueio a robôs (999 do LinkedIn,
 * 403, 429) e falta de resposta contam como funcionando quando o domínio resolve.
 */
export type LinkStatus = { ok: true; note?: string } | { ok: false; reason: string };

export interface LinkCheckOptions {
  fetch?: typeof fetch;
  lookup?: DnsLookup;
  timeoutMs?: number;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_REDIRECTS = 5;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export async function checkLink(raw: string, opts: LinkCheckOptions = {}): Promise<LinkStatus> {
  if (raw.startsWith("mailto:"))
    return EMAIL.test(raw.slice(7))
      ? { ok: true }
      : { ok: false, reason: `E-mail inválido em ${raw}.` };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `Link mal formado: ${raw}.` };
  }
  if (url.hostname === "wa.me") {
    const digits = url.pathname.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 15
      ? { ok: true }
      : { ok: false, reason: `Telefone do WhatsApp inválido em ${raw}.` };
  }
  const guard = urlGuard(opts.lookup ?? defaultDnsLookup);
  const doFetch = opts.fetch ?? fetch;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const blocked = await guard(url);
    if (blocked === UNRESOLVED_HOST)
      return { ok: false, reason: `O domínio de ${raw} não existe (${url.hostname}).` };
    if (blocked) return { ok: false, reason: `${raw}: ${blocked}` };
    let res: Response;
    try {
      res = await doFetch(url.toString(), {
        method: "HEAD",
        redirect: "manual",
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
      });
      if (res.status === 405 || res.status === 501)
        res = await doFetch(url.toString(), {
          method: "GET",
          redirect: "manual",
          headers: { "user-agent": USER_AGENT },
          signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
        });
    } catch {
      return { ok: true, note: `${url.hostname} sem resposta; o domínio existe.` };
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) return { ok: true };
      url = new URL(next, url);
      continue;
    }
    if (res.status === 404 || res.status === 410)
      return { ok: false, reason: `A página ${raw} não existe (${res.status}).` };
    return { ok: true };
  }
  return { ok: false, reason: `Redirecionamentos demais em ${raw}.` };
}
