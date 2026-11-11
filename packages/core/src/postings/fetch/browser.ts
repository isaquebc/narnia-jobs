import { chromium } from "playwright-core";

/**
 * Navegador headless para a busca de vaga por URL (correção do teste do dono, 2026-10-15): o fetch simples falha em
 * site que recusa robôs, página que só existe com JS ou texto escondido atrás do banner de cookies. O Chromium roda
 * no serviço `browser` do compose (imagem própria, rede só com o api; `docker/browser-server.mjs`) e o api conecta
 * por `NARNIA_BROWSER_WS` (mesma versão do playwright-core nos dois lados). Cada busca abre um contexto novo, sem
 * service workers; toda requisição da página passa pelo mesmo anti-SSRF do fetch; imagens, mídia e fontes não
 * carregam. Um botão de "aceitar cookies" visível é clicado uma vez antes de ler o HTML.
 */
export type HostGuard = (url: URL) => Promise<string | null>;

const SKIP_TYPES = new Set(["image", "media", "font"]);

/** Decide cada requisição da página: só http(s) que passa no anti-SSRF; `data:`/`blob:` são locais. */
export async function requestDecision(
  raw: string,
  resourceType: string,
  guard: HostGuard,
): Promise<"continue" | "abort"> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "abort";
  }
  if (url.protocol === "data:" || url.protocol === "blob:") return "continue";
  if (url.protocol !== "http:" && url.protocol !== "https:") return "abort";
  if (SKIP_TYPES.has(resourceType)) return "abort";
  return (await guard(url)) ? "abort" : "continue";
}

/** Texto de botão que aceita cookies (pt e en); "recusar", "configurar" e afins ficam de fora. */
export const COOKIE_ACCEPT =
  /^\s*(aceitar( todos)?( os cookies)?|aceito|accept( all)?( cookies)?|concordo|i agree|agree|allow all|permitir todos|ok|entendi|got it)\s*[.!]?\s*$/i;

/**
 * User-agent de um Chrome comum da mesma versão, sem "HeadlessChrome": CDNs anti-robô (Akamai, na Prisma Consultoria) derrubam
 * a conexão do headless (`ERR_HTTP2_PROTOCOL_ERROR`). A busca continua sendo uma página pedida pelo usuário, com o
 * robots.txt respeitado antes (2026-10-15).
 */
export function browserUserAgent(version: string): string {
  const major = version.split(".")[0] || "130";
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

export interface RenderOptions {
  guard: HostGuard;
  timeoutMs?: number;
  maxBytes?: number;
}

export async function renderInBrowser(
  wsEndpoint: string,
  url: string,
  opts: RenderOptions,
): Promise<{ ok: true; html: string; url: string } | { ok: false; message: string }> {
  const timeout = opts.timeoutMs ?? 30_000;
  let browser: Awaited<ReturnType<typeof chromium.connect>> | null = null;
  try {
    browser = await chromium.connect(wsEndpoint, { timeout: 10_000 });
    const context = await browser.newContext({
      serviceWorkers: "block",
      userAgent: browserUserAgent(browser.version()),
      locale: "pt-BR",
      javaScriptEnabled: true,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    await page.route("**/*", async (route) => {
      const req = route.request();
      const decision = await requestDecision(req.url(), req.resourceType(), opts.guard);
      await (decision === "continue" ? route.continue() : route.abort("blockedbyclient"));
    });
    await page.routeWebSocket(/.*/, (ws) => ws.close());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
    const accept = page.getByRole("button", { name: COOKIE_ACCEPT }).first();
    if (await accept.isVisible().catch(() => false)) {
      await accept.click({ timeout: 2_000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => undefined);
    }
    const finalUrl = page.url();
    if ((await requestDecision(finalUrl, "document", opts.guard)) === "abort")
      return { ok: false, message: "A página redirecionou para um endereço interno." };
    const html = await page.content();
    if (html.length > (opts.maxBytes ?? 5 * 1024 * 1024))
      return { ok: false, message: "Página grande demais." };
    return { ok: true, html, url: finalUrl };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
