import type { Paper } from "@narnia-jobs/shared";
import { chromium } from "playwright-core";

/**
 * PDF do CV pelo serviço `browser` (F05 §2.6, F05-12): o Chromium roda em outro container, sem volumes, então o HTML
 * chega inteiro por `setContent`, com fontes e imagens inline (`data:`). Toda outra requisição é abortada (http, file,
 * blob), WebSocket fechado, service workers bloqueados; JavaScript desligado para templates do usuário. Um contexto
 * novo por documento. Versão do `playwright-core` igual à da imagem `browser` (Dockerfile, ARG PLAYWRIGHT_VERSION).
 */
export function pdfRequestDecision(url: string): "continue" | "abort" {
  return url.startsWith("data:") ? "continue" : "abort";
}

export interface RenderPdfOptions {
  paper: Paper;
  /** Templates padrão: true (não têm script, mas a espera pelas fontes usa JS); do usuário: false. */
  javaScript?: boolean;
  timeoutMs?: number;
}

export type RenderPdfResult =
  | { ok: true; pdf: Buffer; blocked: string[] }
  | { ok: false; message: string };

export async function renderPdf(
  wsEndpoint: string,
  html: string,
  opts: RenderPdfOptions,
): Promise<RenderPdfResult> {
  const timeout = opts.timeoutMs ?? 30_000;
  let browser: Awaited<ReturnType<typeof chromium.connect>> | null = null;
  try {
    browser = await chromium.connect(wsEndpoint, { timeout: 10_000 });
    const context = await browser.newContext({
      serviceWorkers: "block",
      javaScriptEnabled: opts.javaScript ?? true,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    const blocked: string[] = [];
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (pdfRequestDecision(url) === "continue") return route.continue();
      blocked.push(url);
      return route.abort("blockedbyclient");
    });
    await page.routeWebSocket(/.*/, (s) => s.close());
    await page.setContent(html, { waitUntil: "load", timeout });
    if (opts.javaScript ?? true) await page.evaluate("document.fonts.ready.then(() => true)");
    const pdf = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      format: opts.paper,
    });
    return { ok: true, pdf, blocked };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
