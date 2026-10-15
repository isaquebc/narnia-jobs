import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

/**
 * Busca de vaga por URL (F06-3, §2.2): `fetch` nativo (undici), GET único, até 3 redirects conferidos um a um, só
 * http(s), bloqueio de IP privado/loopback/link-local depois da resolução de DNS (anti-SSRF), respeito ao robots.txt,
 * 2 MB e 15 s. Nunca executa JS: página que só existe com JS volta `extract_failed` e a UI pede para colar o texto.
 */
export type FetchFailure =
  | "invalid_url"
  | "blocked_host"
  | "robots"
  | "too_large"
  | "timeout"
  | "http_error"
  | "extract_failed";

export type FetchPostingResult =
  | {
      ok: true;
      url: string;
      text: string;
      title: string | null;
      siteName: string | null;
      html: string;
    }
  | { ok: false; code: FetchFailure; message: string };

export interface FetchPostingOptions {
  fetch?: typeof fetch;
  /** Resolução de DNS (testes trocam); devolve todos os endereços do host. */
  lookup?: (host: string) => Promise<string[]>;
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
}

const MAX_REDIRECTS = 3;
const MIN_TEXT = 200;
export const POSTING_USER_AGENT = "narnia-jobs/0.1 (+https://github.com/isaquebc/narnia-jobs)";

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

const fail = (code: FetchFailure, message: string): FetchPostingResult => ({
  ok: false,
  code,
  message,
});

async function defaultLookup(host: string): Promise<string[]> {
  return (await dnsLookup(host, { all: true })).map((a) => a.address);
}

async function checkHost(
  url: URL,
  lookup: (h: string) => Promise<string[]>,
): Promise<string | null> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Só endereços http(s).";
  if (url.username || url.password) return "Endereço com credenciais não é aceito.";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return "Endereço local não é aceito.";
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await lookup(host);
  } catch {
    return "Não consegui resolver o endereço.";
  }
  if (addresses.length === 0 || addresses.some(isBlockedAddress))
    return "Endereço de rede interna não é aceito.";
  return null;
}

/** Corpo com teto de bytes: passa do teto = null. */
async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** robots.txt: grupo `*` (ou do nosso agente) com Disallow/Allow por prefixo; o mais específico vence. */
export function robotsAllows(robots: string, path: string, agent = "narnia-jobs"): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; prefix: string }> }> = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = (m[1] as string).toLowerCase();
    const value = (m[2] as string).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "disallow" && value) current.rules.push({ allow: false, prefix: value });
    if (key === "allow" && value) current.rules.push({ allow: true, prefix: value });
  }
  const mine = groups.filter((g) =>
    g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)),
  );
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap(
    (g) => g.rules,
  );
  let best: { allow: boolean; prefix: string } | null = null;
  for (const r of rules) {
    const prefix = r.prefix.replace(/\*$/, "");
    if (path.startsWith(prefix) && (!best || prefix.length > best.prefix.length))
      best = { allow: r.allow, prefix };
  }
  return best ? best.allow : true;
}

export async function fetchPostingPage(
  rawUrl: string,
  opts: FetchPostingOptions = {},
): Promise<FetchPostingResult> {
  const f = opts.fetch ?? fetch;
  const lookup = opts.lookup ?? defaultLookup;
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const headers = {
    "user-agent": opts.userAgent ?? POSTING_USER_AGENT,
    accept: "text/html,*/*;q=0.5",
  };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fail("invalid_url", "Endereço inválido.");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
  try {
    const blocked = await checkHost(url, lookup);
    if (blocked)
      return fail(url.protocol.startsWith("http") ? "blocked_host" : "invalid_url", blocked);
    // robots.txt do host: indisponível = permitido (como os buscadores)
    try {
      const r = await f(new URL("/robots.txt", url), {
        headers,
        signal: ctrl.signal,
        redirect: "manual",
      });
      if (r.ok) {
        const robots = (await readCapped(r, 256 * 1024)) ?? "";
        if (!robotsAllows(robots, url.pathname + url.search))
          return fail(
            "robots",
            "O site não permite buscar esta página (robots.txt). Cole o texto da vaga.",
          );
      }
    } catch (e) {
      if (ctrl.signal.aborted) throw e;
    }
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await f(url, { headers, signal: ctrl.signal, redirect: "manual" });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (hop === MAX_REDIRECTS) return fail("http_error", "Redirecionamentos demais.");
        url = new URL(res.headers.get("location") as string, url);
        const again = await checkHost(url, lookup);
        if (again) return fail("blocked_host", again);
        continue;
      }
      break;
    }
    if (!res?.ok) return fail("http_error", `O site respondeu ${res?.status ?? "sem resposta"}.`);
    const html = await readCapped(res, maxBytes);
    if (html === null) return fail("too_large", "Página maior que 2 MB.");
    return extractPosting(html, url.toString());
  } catch (e) {
    if (ctrl.signal.aborted) return fail("timeout", "O site demorou demais para responder.");
    return fail("http_error", (e as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

/** Texto principal (Readability sobre linkedom), título e `og:` da página; pouco texto = `extract_failed`. */
export function extractPosting(html: string, url: string): FetchPostingResult {
  const { document } = parseHTML(html);
  const meta = (name: string) =>
    document.querySelector(`meta[property="${name}"]`)?.getAttribute("content")?.trim() || null;
  let text = "";
  let title: string | null = null;
  try {
    const article = new Readability(
      document as unknown as ConstructorParameters<typeof Readability>[0],
    ).parse();
    text = (article?.textContent ?? "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    title = article?.title?.trim() || null;
  } catch {
    text = "";
  }
  if (text.length < MIN_TEXT)
    return fail(
      "extract_failed",
      "Não consegui extrair o texto da vaga desta página (ela pode depender de JavaScript). Cole o texto.",
    );
  return {
    ok: true,
    url,
    text,
    title: meta("og:title") ?? title,
    siteName: meta("og:site_name"),
    html,
  };
}
