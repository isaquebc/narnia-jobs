import { createServer } from "node:http";
import {
  deleteGoogleClient,
  disconnectGmail,
  domainOfAddress,
  finishGmailConnect,
  gmailStatus,
  isWebmail,
  MAIL_FORCE_KEY,
  MAIL_LAST_SYNC_KEY,
  MAIL_SINCE_KEY,
  oauthRedirectUri,
  type PendingGmailConnect,
  platformOf,
  type Repos,
  readGmailToken,
  resolveGoogleClient,
  resolveMailReconnect,
  SCHEDULED_RUN_TASK,
  saveGoogleClient,
  startGmailConnect,
} from "@narnia-jobs/core";
import { Hono } from "hono";
import { z } from "zod";
import { apiError } from "../errors";
import type { EventBus } from "../events";
import type { QueueAdapter } from "../queue";
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

const MailSettingsSchema = z.object({ since: z.iso.datetime() });
/** Endereço (`rh@acme.example`) ou domínio com @ (`@acme.example`). */
const SenderValueSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^([^@\s]+@[^@\s]+\.[^@\s]+|@[a-z0-9.-]+\.[a-z]{2,})$/, "use um endereço ou @domínio");
const SenderPutSchema = z.object({
  value: SenderValueSchema,
  override: z.enum(["trusted", "blocked"]),
  origin: z.enum(["manual", "extension", "review"]).default("manual"),
});
const ProcessSchema = z.object({ gmailId: z.string().regex(/^[0-9a-f]{8,32}$/i) });

export function gmailRoutes(deps: {
  repos: Repos;
  /** Para "rodar a leitura agora" depois de confiar num remetente ou de um pedido da extensão. */
  queue?: QueueAdapter;
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

  // F14/M2: janela da primeira leitura (pedido do dono) e o resumo do que já foi lido
  const mailView = () => ({
    since: deps.repos.settings.get<string>(MAIL_SINCE_KEY) ?? null,
    lastSyncAt: deps.repos.settings.get<string>(MAIL_LAST_SYNC_KEY) ?? null,
    counts: deps.repos.mail.counts(),
  });
  app.get("/api/mail/settings", (c) => c.json(mailView()));

  // F14/M3 · lista de remetentes (F14-13): confiáveis e bloqueados, sugestões pelo histórico
  const runSyncNow = async () =>
    deps.queue?.enqueueTask({
      queue: "scheduled",
      type: SCHEDULED_RUN_TASK,
      key: "mail.sync",
      payload: { taskId: "mail.sync", trigger: "manual" },
    });
  const sendersView = () => {
    const all = deps.repos.mailSenders.list();
    return {
      trusted: all.filter((s) => s.override === "trusted"),
      blocked: all.filter((s) => s.override === "blocked"),
      suggestions: all.filter(
        (s) =>
          !s.override &&
          !s.value.startsWith("@") &&
          s.okCount >= 3 &&
          s.rejectedCount === 0 &&
          !platformOf(domainOfAddress(s.value)),
      ),
    };
  };
  app.get("/api/mail/senders", (c) => c.json(sendersView()));
  app.put("/api/mail/senders", validate("json", SenderPutSchema), (c) => {
    const { value, override, origin } = c.req.valid("json");
    // revisão do M3: a extensão pode mandar o próprio endereço (a última mensagem aberta era a resposta da pessoa)
    const own = readGmailToken(deps.dataDir)?.email?.toLowerCase();
    if (own && value === own)
      return apiError(
        c,
        422,
        "own_address",
        "Esse é o seu próprio endereço; abra um e-mail recebido e tente de novo",
      );
    if (value.startsWith("@") && isWebmail(value.slice(1)))
      return apiError(
        c,
        422,
        "webmail_domain",
        "Domínio de webmail só entra por endereço (confiar no domínio liberaria qualquer pessoa)",
      );
    const sender = deps.repos.mailSenders.setOverride(
      value,
      override,
      origin,
      new Date().toISOString(),
    );
    const quarantined =
      override === "trusted" ? deps.repos.mail.bySender(value, "quarantine").length : 0;
    return c.json({ sender, quarantined, ...sendersView() });
  });
  app.delete("/api/mail/senders/:value", (c) => {
    const value = c.req.param("value").toLowerCase();
    deps.repos.mailSenders.setOverride(value, null, null, new Date().toISOString());
    return c.json(sendersView());
  });
  app.post("/api/mail/senders/:value/reprocess", async (c) => {
    const value = c.req.param("value").toLowerCase();
    const msgs = deps.repos.mail.bySender(value, "quarantine");
    const at = new Date().toISOString();
    // volta para a avaliação; se sair da quarentena, a tarefa agendada tira a etiqueta de suspeito do Gmail
    for (const m of msgs) deps.repos.mail.reset(m.id, at);
    if (msgs.length) await runSyncNow();
    return c.json({ reprocessed: msgs.length });
  });
  // extensão: "processar este e-mail agora" (o id da mensagem aberta no Gmail web)
  app.post("/api/mail/process", validate("json", ProcessSchema), async (c) => {
    const { gmailId } = c.req.valid("json");
    const known = deps.repos.mail.byGmailId(gmailId);
    if (known) return c.json({ status: "known", mail: { id: known.id, status: known.status } });
    const list = deps.repos.settings.get<string[]>(MAIL_FORCE_KEY) ?? [];
    if (!list.includes(gmailId)) deps.repos.settings.set(MAIL_FORCE_KEY, [...list, gmailId]);
    await runSyncNow();
    return c.json({ status: "queued" }, 202);
  });
  app.put("/api/mail/settings", validate("json", MailSettingsSchema), (c) => {
    const since = new Date(c.req.valid("json").since);
    const now = Date.now();
    if (since.getTime() > now)
      return apiError(c, 422, "since_in_future", "A data não pode ser no futuro");
    // um ano, com folga para a meia-noite local e o 29 de fevereiro
    if (since.getTime() < now - 367 * 86_400_000)
      return apiError(c, 422, "since_too_old", "Leia no máximo um ano para trás");
    const previous = deps.repos.settings.get<string>(MAIL_SINCE_KEY);
    deps.repos.settings.set(MAIL_SINCE_KEY, since.toISOString());
    // janela maior que a anterior: a próxima leitura volta ao começo (o gmail_id único evita repetir)
    if (!previous || since.toISOString() < previous)
      deps.repos.settings.set(MAIL_LAST_SYNC_KEY, null);
    return c.json(mailView());
  });

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
      await resolveMailReconnect(deps.repos, async (e) => deps.bus?.emit(e));
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
    await resolveMailReconnect(deps.repos, async (e) => deps.bus?.emit(e));
    deps.bus?.emit({ type: "gmail.updated" });
    return c.json(view());
  });

  return app;
}
