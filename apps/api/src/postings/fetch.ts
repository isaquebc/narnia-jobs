import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { renderInBrowser } from "./browser";

/**
 * Busca de vaga por URL (F06-3, §2.2): `fetch` nativo (undici), GET único, até 3 redirects conferidos um a um, só
 * http(s), bloqueio de IP privado/loopback/link-local depois da resolução de DNS (anti-SSRF), respeito ao robots.txt,
 * 2 MB e 15 s. O texto sai do JSON-LD `JobPosting` da página (muitos sites de vaga trazem, mesmo atrás do banner de
 * cookies) ou do Readability. Correção de 2026-10-15: quando o fetch simples falha (site que recusa, página só com
 * JS), a página é aberta num navegador headless (serviço `browser`, `./browser.ts`) com o mesmo anti-SSRF por
 * requisição; robots.txt e endereço interno nunca chegam ao navegador.
 */
export type FetchFailure =
  | "invalid_url"
  | "blocked_host"
  | "robots"
  | "too_large"
  | "timeout"
  | "http_error"
  | "extract_failed"
  | "blocked_page";

export type FetchPostingResult =
  | {
      ok: true;
      url: string;
      text: string;
      title: string | null;
      siteName: string | null;
      /** Empresa contratante do JSON-LD (`hiringOrganization`), quando a página traz. */
      company: string | null;
      html: string;
      /** Como a página foi lida: fetch simples ou navegador headless. */
      via: "fetch" | "browser";
    }
  | { ok: false; code: FetchFailure; message: string };

export interface FetchPostingOptions {
  fetch?: typeof fetch;
  /** Resolução de DNS (testes trocam); devolve todos os endereços do host. */
  lookup?: (host: string) => Promise<string[]>;
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
  /**
   * Navegador headless para quando o fetch simples falha; ausente = o do ambiente (`NARNIA_BROWSER_WS`), null =
   * desligado.
   */
  render?: PageRender | null;
  /**
   * Teto do fetch simples quando há navegador (padrão 8 s): site que segura robôs (CDN anti-robô) não consome o tempo
   * todo antes do navegador tentar. Sem navegador vale `timeoutMs` (15 s).
   */
  plainTimeoutWithBrowserMs?: number;
}

/** Abre a página num navegador (com o anti-SSRF por requisição) e devolve o HTML renderizado e a URL final. */
export type PageRender = (
  url: string,
) => Promise<{ ok: true; html: string; url: string } | { ok: false; message: string }>;

const MAX_REDIRECTS = 3;
const BLOCKED_PAGE =
  /\b(blocked|bloquead[oa]|captcha|access denied|acesso negado|just a moment|verify(ing)? you are (a )?human|are you a robot|unusual traffic|tráfego incomum)\b/i;
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

/** Endereço permitido (anti-SSRF)? null = sim; texto = motivo da recusa. Usado também pelo navegador. */
export function hostGuard(lookup: (h: string) => Promise<string[]> = defaultLookup) {
  return (url: URL) => checkHost(url, lookup);
}

export async function fetchPostingPage(
  rawUrl: string,
  opts: FetchPostingOptions = {},
): Promise<FetchPostingResult> {
  const render = opts.render === undefined ? defaultRender(opts) : opts.render;
  const first = await fetchPlain(
    rawUrl,
    render && opts.timeoutMs === undefined
      ? { ...opts, timeoutMs: opts.plainTimeoutWithBrowserMs ?? 8_000 }
      : opts,
  );
  if (first.ok || !first.retry || !render) return first.result;
  const page = await render(first.url);
  if (!page.ok) return first.result;
  const fromBrowser = extractPosting(page.html, page.url, "browser");
  return fromBrowser.ok ? fromBrowser : first.result;
}

/** Navegador do ambiente: `NARNIA_BROWSER_WS` (serviço `browser` do compose); sem a variável, desligado. */
function defaultRender(opts: FetchPostingOptions): PageRender | null {
  const ws = process.env.NARNIA_BROWSER_WS;
  if (!ws) return null;
  return (url) => renderInBrowser(ws, url, { guard: hostGuard(opts.lookup ?? defaultLookup) });
}

type PlainOutcome =
  | { ok: true; result: FetchPostingResult }
  | { ok: false; result: FetchPostingResult; retry: boolean; url: string };

/** Fetch simples. `retry` = vale tentar o navegador (site recusou, demorou ou a página não tinha texto sem JS). */
async function fetchPlain(rawUrl: string, opts: FetchPostingOptions): Promise<PlainOutcome> {
  const r = await fetchPlainPage(rawUrl, opts);
  if (r.result.ok) return { ok: true, result: r.result };
  const retry = ["http_error", "extract_failed", "timeout", "blocked_page"].includes(r.result.code);
  return { ok: false, result: r.result, retry, url: r.url };
}

async function fetchPlainPage(
  rawUrl: string,
  opts: FetchPostingOptions,
): Promise<{ result: FetchPostingResult; url: string }> {
  const out = (result: FetchPostingResult) => ({ result, url: url?.toString() ?? rawUrl });
  const f = opts.fetch ?? fetch;
  const lookup = opts.lookup ?? defaultLookup;
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const headers = {
    "user-agent": opts.userAgent ?? POSTING_USER_AGENT,
    accept: "text/html,*/*;q=0.5",
  };
  let url: URL | undefined;
  try {
    url = new URL(rawUrl);
  } catch {
    return out(fail("invalid_url", "Endereço inválido."));
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
  try {
    const blocked = await checkHost(url, lookup);
    if (blocked)
      return out(fail(url.protocol.startsWith("http") ? "blocked_host" : "invalid_url", blocked));
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
          return out(
            fail(
              "robots",
              "O site não permite buscar esta página (robots.txt). Cole o texto da vaga.",
            ),
          );
      }
    } catch (e) {
      if (ctrl.signal.aborted) throw e;
    }
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await f(url, { headers, signal: ctrl.signal, redirect: "manual" });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (hop === MAX_REDIRECTS) return out(fail("http_error", "Redirecionamentos demais."));
        url = new URL(res.headers.get("location") as string, url);
        const again = await checkHost(url, lookup);
        if (again) return out(fail("blocked_host", again));
        continue;
      }
      break;
    }
    if (!res?.ok)
      return out(fail("http_error", `O site respondeu ${res?.status ?? "sem resposta"}.`));
    const html = await readCapped(res, maxBytes);
    if (html === null) return out(fail("too_large", "Página maior que 2 MB."));
    return out(extractPosting(html, url.toString()));
  } catch (e) {
    if (ctrl.signal.aborted) return out(fail("timeout", "O site demorou demais para responder."));
    return out(fail("http_error", (e as Error).message));
  } finally {
    clearTimeout(timer);
  }
}

/** Texto principal: JSON-LD `JobPosting` quando a página traz; senão Readability sobre linkedom. Pouco texto = `extract_failed`. */
export function extractPosting(
  html: string,
  url: string,
  via: "fetch" | "browser" = "fetch",
): FetchPostingResult {
  const { document } = parseHTML(html);
  const meta = (name: string) =>
    document.querySelector(`meta[property="${name}"]`)?.getAttribute("content")?.trim() || null;
  const ld = jobPostingFromJsonLd(document);
  if (ld && ld.text.length >= MIN_TEXT)
    return {
      ok: true,
      url,
      text: ld.text,
      title: ld.title ?? meta("og:title"),
      siteName: meta("og:site_name"),
      company: ld.company,
      html,
      via,
    };
  // texto do conteúdo principal, antes do Readability (que altera o documento)
  const main = mainText(document);
  const h1 =
    (document.querySelector("main h1, [role=main] h1, h1")?.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim() || null;
  let text = "";
  let title: string | null = null;
  try {
    const article = new Readability(
      document as unknown as ConstructorParameters<typeof Readability>[0],
    ).parse();
    // o HTML do artigo, não o textContent: blocos e itens viram linhas
    text = article?.content
      ? htmlToLines(article.content)
      : (article?.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
    title = article?.title?.trim() || null;
  } catch {
    text = "";
  }
  // vaga dividida em vários blocos (Prisma Consultoria: impacto, crescimento, requisitos): o Readability fica com o maior e
  // perde o resto; cobrindo menos da metade do conteúdo principal, ou sem a seção de requisitos que o conteúdo
  // principal tem, vale o conteúdo principal inteiro
  if (
    main.length <= MAIN_TEXT_MAX &&
    (text.length < main.length * 0.5 || (REQUIREMENTS.test(main) && !REQUIREMENTS.test(text)))
  )
    text = main;
  // página de bloqueio, captcha ou checagem anti-robô (curta e com o aviso no título ou no texto) não é a vaga
  const pageTitle = document.querySelector("title")?.textContent ?? "";
  if (text.length < 2000 && BLOCKED_PAGE.test(`${pageTitle}\n${text.slice(0, 600)}`))
    return fail(
      "blocked_page",
      "O site bloqueou a leitura automática desta página. Cole o texto da vaga.",
    );
  if (text.length < MIN_TEXT)
    return fail(
      "extract_failed",
      "Não consegui extrair o texto da vaga desta página (ela pode depender de JavaScript ou de login). Cole o texto.",
    );
  return {
    ok: true,
    url,
    text,
    // og:title, senão o <h1> (o <title> costuma ser genérico: "Jobs", "Vagas")
    title: meta("og:title") ?? h1 ?? title,
    siteName: meta("og:site_name"),
    company: null,
    html,
    via,
  };
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Procura um `JobPosting` em todos os `<script type="application/ld+json">` (objeto, lista ou `@graph`). */
function findJobPosting(document: ReturnType<typeof parseHTML>["document"]): Json | null {
  const visit = (v: unknown): Json | null => {
    if (Array.isArray(v)) {
      for (const x of v) {
        const hit = visit(x);
        if (hit) return hit;
      }
      return null;
    }
    if (!isObj(v)) return null;
    const type = v["@type"];
    if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return v;
    return visit(v["@graph"]);
  };
  for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const hit = visit(JSON.parse(el.textContent ?? ""));
      if (hit) return hit;
    } catch {
      // JSON-LD quebrado: ignora e segue
    }
  }
  return null;
}

const MAIN_TEXT_MAX = 30_000;
/** Cabeçalho de requisitos (pt e en): toda vaga tem; se o Readability perdeu, perdeu a parte que mais importa. */
const REQUIREMENTS =
  /\b(requisitos|qualifica[cç][oõ]es|o que (buscamos|esperamos)|requirements|qualifications|what you('ll)? (need|bring)|must have|skills)\b/i;
const NOT_CONTENT =
  "script, style, noscript, template, svg, iframe, nav, aside, form, button, [role=navigation], [aria-hidden=true]";
/** Cabeçalho e rodapé do site; dentro do `<main>` são do artigo (o cargo costuma estar no `<header>` dele). */
const SITE_CHROME = "header, footer, [role=banner], [role=contentinfo]";

/** Texto do `<main>` (ou do `<body>`) sem menu, cabeçalho e rodapé do site, formulários e scripts, em linhas. */
function mainText(document: ReturnType<typeof parseHTML>["document"]): string {
  const main = document.querySelector("main, [role=main]");
  const root = main ?? document.body;
  if (!root) return "";
  const { document: copy } = parseHTML(
    `<!doctype html><html><body>${root.innerHTML}</body></html>`,
  );
  for (const el of copy.querySelectorAll(main ? NOT_CONTENT : `${NOT_CONTENT}, ${SITE_CHROME}`))
    el.remove();
  return htmlToLines(copy.body?.innerHTML ?? "");
}

/** HTML da descrição em texto com quebras: blocos e `<br>` viram linha, itens de lista ganham "- ". */
function htmlToLines(fragment: string): string {
  // alguns sites mandam a descrição com o HTML escapado (&lt;p&gt;): desfaz uma vez
  const html =
    /&lt;\w/.test(fragment) && !/<\w/.test(fragment)
      ? (parseHTML(`<!doctype html><html><body>${fragment}</body></html>`).document.body
          ?.textContent ?? fragment)
      : fragment;
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  for (const br of document.querySelectorAll("br")) br.replaceWith(document.createTextNode("\n"));
  for (const li of document.querySelectorAll("li")) li.prepend(document.createTextNode("\n- "));
  for (const h of document.querySelectorAll("h1, h2, h3, h4, h5, h6"))
    h.prepend(document.createTextNode("\n"));
  for (const b of document.querySelectorAll("p, div, h1, h2, h3, h4, h5, h6, ul, ol, section"))
    b.append(document.createTextNode("\n"));
  return (
    String(document.body?.textContent ?? "")
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      // linha em branco só entre parágrafos: nunca dupla nem antes de item de lista
      .filter(
        (l, i, all) => l !== "" || (i > 0 && all[i - 1] !== "" && !all[i + 1]?.startsWith("- ")),
      )
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Texto da vaga a partir do JSON-LD: cabeçalho (cargo, empresa, local, contrato) e a descrição em linhas. */
function jobPostingFromJsonLd(
  document: ReturnType<typeof parseHTML>["document"],
): { text: string; title: string | null; company: string | null } | null {
  const job = findJobPosting(document);
  if (!job) return null;
  const description = str(job.description);
  if (!description) return null;
  const title = str(job.title);
  const org = job.hiringOrganization;
  const company = isObj(org) ? str(org.name) : str(org);
  const places = (Array.isArray(job.jobLocation) ? job.jobLocation : [job.jobLocation])
    .map((l) => (isObj(l) && isObj(l.address) ? l.address : null))
    .filter((a): a is Json => a !== null)
    .map((a) => [str(a.addressLocality), str(a.addressRegion)].filter(Boolean).join(" - "))
    .filter(Boolean);
  const remote = str(job.jobLocationType) === "TELECOMMUTE" ? "Remoto" : null;
  const local = [...new Set(places)].concat(remote ? [remote] : []).join(" · ");
  const types = (Array.isArray(job.employmentType) ? job.employmentType : [job.employmentType])
    .map(str)
    .filter(Boolean)
    .join(", ");
  const header = [
    title,
    company ? `Empresa: ${company}` : null,
    local ? `Local: ${local}` : null,
    types ? `Contrato: ${types}` : null,
    str(job.datePosted) ? `Publicada em: ${str(job.datePosted)}` : null,
  ].filter(Boolean);
  return {
    text: `${header.join("\n")}\n\n${htmlToLines(description)}`.trim(),
    title,
    company,
  };
}
