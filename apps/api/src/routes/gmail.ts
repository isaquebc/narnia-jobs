import { createServer } from "node:http";
import {
  deleteGoogleClient,
  disconnectGmail,
  finishGmailConnect,
  gmailStatus,
  oauthRedirectUri,
  type PendingGmailConnect,
  resolveGoogleClient,
  saveGoogleClient,
  startGmailConnect,
} from "@narnia-jobs/core";
import { Hono } from "hono";
import { z } from "zod";
import { apiError } from "../errors";
import type { EventBus } from "../events";
import { validate } from "./validate";

/**
 * Configurações › Gmail (F14-4, plans/plan-v0/tasks/F14-leitura-de-emails.md §2.0.3): status da conexão, cliente
 * OAuth (do `.env` ou salvo aqui, o segredo nunca volta), conectar (o api escuta o retorno do Google na porta
 * NARNIA_OAUTH_PORT só durante o login) e desconectar (revoga no Google e apaga o token).
 */
export type CallbackResult = { status: number; html: string };
export type CallbackListener = (
  port: number,
  handle: (url: URL) => Promise<CallbackResult>,
) => Promise<{ close: () => void }>;

/** Servidor HTTP do retorno, só durante o login; fecha sozinho depois do primeiro retorno válido. */
export const listenOAuthCallback: CallbackListener = (port, handle) =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const send = (status: number, html: string) => {
        if (!res.headersSent) res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
      };
      let url: URL;
      try {
        url = new URL(req.url ?? "/", `http://localhost:${port}`);
      } catch {
        send(400, "");
        return;
      }
      if (url.pathname !== "/callback") {
        send(404, "");
        return;
      }
      handle(url)
        .then((r) => send(r.status, r.html))
        .catch(() => send(500, callbackPage("Erro", "Falha inesperada; tente conectar de novo.")));
    });
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", reject);
      server.on("error", () => {});
      resolve({ close: () => server.close() });
    });
  });

const escapeHtml = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string,
  );

/** Página do retorno: o texto vem do Google ou da URL (`error=`), então sempre escapado. */
export const callbackPage = (title: string, text: string) =>
  `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>narnia-jobs</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p></body></html>`;

const ClientSchema = z.object({
  clientId: z.string().trim().min(10).max(300),
  clientSecret: z.string().trim().min(5).max(300),
});

export function gmailRoutes(deps: {
  dataDir: string;
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  port: number;
  bus?: EventBus;
  listen?: CallbackListener;
  /** Tempo de espera do login (padrão 10 min). */
  connectTtlMs?: number;
}) {
  const app = new Hono();
  const listen = deps.listen ?? listenOAuthCallback;
  const client = () => resolveGoogleClient(deps.env, deps.dataDir);
  let pending: PendingGmailConnect | null = null;
  let listener: { close: () => void } | null = null;
  let timer: NodeJS.Timeout | null = null;
  let lastError: string | null = null;
  let starting = false;
  let attempt = 0;
  const stop = () => {
    listener?.close();
    listener = null;
    pending = null;
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const view = () => ({
    ...gmailStatus(deps.dataDir, client()),
    connecting: !!pending,
    lastError,
    callbackPort: deps.port,
    redirectUri: oauthRedirectUri(deps.port),
  });

  app.get("/api/integrations/gmail", (c) => c.json(view()));

  app.put("/api/integrations/gmail/client", validate("json", ClientSchema), (c) => {
    if (client()?.source === "env")
      return apiError(
        c,
        409,
        "client_from_env",
        "O cliente OAuth vem do .env (GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET)",
      );
    saveGoogleClient(deps.dataDir, c.req.valid("json"));
    return c.json(view());
  });

  app.delete("/api/integrations/gmail/client", (c) => {
    if (client()?.source === "env")
      return apiError(
        c,
        409,
        "client_from_env",
        "O cliente OAuth vem do .env; tire de lá para trocar",
      );
    deleteGoogleClient(deps.dataDir);
    return c.json(view());
  });

  app.post("/api/integrations/gmail/connect", async (c) => {
    const cl = client();
    if (!cl) return apiError(c, 409, "not_configured", "Configure o cliente OAuth do Google antes");
    // revisão do M1: um clique duplo não derruba o login que já devolveu a URL
    if (starting)
      return apiError(c, 409, "connect_in_progress", "O login do Google já está sendo aberto");
    starting = true;
    const mine = ++attempt;
    try {
      stop();
      lastError = null;
      const start = startGmailConnect({
        client: cl,
        redirectUri: oauthRedirectUri(deps.port),
        ...(deps.connectTtlMs ? { ttlMs: deps.connectTtlMs } : {}),
      });
      pending = start.pending;
      try {
        listener = await listen(deps.port, (url) => onCallback(url, cl));
      } catch (e) {
        if (attempt === mine) stop();
        return apiError(
          c,
          409,
          "callback_port_busy",
          `A porta ${deps.port} do retorno do Google está ocupada (${(e as Error).message}); feche o outro login (ou o \`google connect\` do Calendar) e tente de novo`,
        );
      }
      timer = setTimeout(
        () => {
          if (attempt === mine) stop();
        },
        deps.connectTtlMs ?? 10 * 60_000,
      );
      timer.unref?.();
      return c.json({ authUrl: start.url, ...view() });
    } finally {
      starting = false;
    }
  });

  /** Retorno do Google: consome o `state` antes da troca (um segundo retorno igual não troca de novo). */
  async function onCallback(
    url: URL,
    cl: NonNullable<ReturnType<typeof client>>,
  ): Promise<CallbackResult> {
    const state = url.searchParams.get("state");
    if (!pending || state !== pending.state) {
      if (gmailStatus(deps.dataDir, client()).status === "connected")
        return {
          status: 200,
          html: callbackPage("Gmail conectado", "Pode fechar esta aba e voltar ao narnia."),
        };
      return {
        status: 400,
        html: callbackPage(
          "Não conectou",
          "Login expirado ou de outra tentativa: clique em Conectar de novo no narnia.",
        ),
      };
    }
    const consumed = pending;
    pending = null;
    try {
      const r = await finishGmailConnect({
        fetch: deps.fetch,
        dataDir: deps.dataDir,
        client: cl,
        pending: consumed,
        params: url.searchParams,
      });
      lastError = null;
      return {
        status: 200,
        html: callbackPage(
          "Gmail conectado",
          `Conta ${r.email}. Pode fechar esta aba e voltar ao narnia.`,
        ),
      };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      return { status: 400, html: callbackPage("Não conectou", lastError) };
    } finally {
      stop();
      deps.bus?.emit({ type: "gmail.updated" });
    }
  }

  app.delete("/api/integrations/gmail", async (c) => {
    stop();
    await disconnectGmail({ fetch: deps.fetch, dataDir: deps.dataDir });
    deps.bus?.emit({ type: "gmail.updated" });
    return c.json(view());
  });

  return app;
}
