import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { simpleParser } from "mailparser";
import type { Repos } from "../db";
import type { ScheduledContext } from "../scheduler";
import { MailAuthError, readGmailToken, writeGmailToken } from "./google-oauth";
import { GmailApiError, type MailSource } from "./source";

/**
 * Sincronização do Gmail (F14/M2, plans/plan-v0/tasks/F14-leitura-de-emails.md §2.2): baixa os e-mails de vagas e
 * candidaturas para `<dados>/mail/<gmail_id>.eml` e registra cada um como pendente. Não mexe no Gmail: etiqueta e lido
 * só depois de processar (M3 em diante).
 *
 * Decisão do M2 (muda §2.1): a leitura é a busca `after:`/`before:` em fatias de uma semana com um cursor, não o
 * `history.list`. A busca já é o primeiro filtro (só remetentes e assuntos de vagas), e o histórico devolveria todos os
 * e-mails da caixa para filtrar aqui; o `gmail_id` único evita repetir (revisão do M2: as fatias garantem a ordem do
 * mais antigo para o mais novo e que nenhum e-mail da janela fica de fora por limite de busca).
 */
export const MAIL_DIR = "mail";
export const MAIL_SINCE_KEY = "mail.since";
export const MAIL_LAST_SYNC_KEY = "mail.lastSyncAt";
export const MAIL_QUERY_KEY = "mail.query";
/** Primeira leitura: no máximo isso de ids listados; cada execução baixa até `MAIL_FETCH_PER_RUN` (o resto na próxima). */
export const MAIL_LIST_MAX = 10_000;
export const MAIL_FETCH_PER_RUN = 300;

/** Plataformas de vagas e ATS mais comuns (M0: Glassdoor, LinkedIn e Coders são a maior parte) e assuntos típicos. */
const SENDERS = [
  "linkedin.com",
  "glassdoor.com",
  "glassdoor.com.br",
  "coders.com.br",
  "gupy.io",
  "indeed.com",
  "vagas.com.br",
  "catho.com.br",
  "infojobs.com.br",
  "greenhouse.io",
  "lever.co",
  "myworkday.com",
  "jobs2web.com",
  "inhire.app",
  "nerdin.com.br",
  "smartrecruiters.com",
  "workablemail.com",
  "kenoby.com",
  "solides.com.br",
  "programathor.com.br",
  "remotar.com.br",
];
const SUBJECTS = [
  "vaga",
  "vagas",
  "candidatura",
  '"processo seletivo"',
  "entrevista",
  "oportunidade",
  "application",
  "interview",
  '"job alert"',
  "position",
];
export const DEFAULT_MAIL_QUERY = `{${[...SENDERS.map((s) => `from:${s}`), ...SUBJECTS.map((s) => `subject:${s}`)].join(" ")}} -in:sent -in:drafts`;

export const mailRawPath = (gmailId: string) =>
  join(MAIL_DIR, `${gmailId.replace(/[^\w-]/g, "_")}.eml`);

export interface MailHeaders {
  fromAddr: string | null;
  fromName: string | null;
  replyTo: string | null;
  subject: string | null;
}

/** Cabeçalho do e-mail bruto (palavras codificadas, charsets e dobras resolvidas pelo `mailparser`). */
export async function parseMailHeaders(raw: Buffer): Promise<MailHeaders> {
  const parsed = await simpleParser(raw, {
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipImageLinks: true,
  });
  const from = parsed.from?.value?.[0];
  const reply = parsed.replyTo?.value?.[0];
  return {
    fromAddr: from?.address?.toLowerCase() ?? null,
    fromName: from?.name || null,
    replyTo: reply?.address?.toLowerCase() ?? null,
    subject: parsed.subject ?? null,
  };
}

export interface MailSyncResult {
  skipped?: "not_connected" | "no_window";
  fetched: number;
  /** A leitura chegou até agora (sem fatia pendente). */
  caughtUp: boolean;
  errors: number;
}

/** Até onde a janela já foi lida, e de qual janela (mudou a janela, o cursor recomeça do começo dela). */
export interface MailCursor {
  since: string;
  at: string;
}
export const MAIL_CURSOR_KEY = "mail.cursor";
/** E-mails pedidos pela extensão ("processar este e-mail agora"): baixados antes da busca, fora dela. */
export const MAIL_FORCE_KEY = "mail.forceIds";
export const MAIL_FAILURES_KEY = "mail.fetchFailures";
/** Fatia da busca: a janela é percorrida do mais antigo para o mais novo, uma semana por vez (§2.2). */
const SLICE_MS = 7 * 86_400_000;
/** Sobreposição da fatia seguinte: e-mail que entra na caixa com data anterior (importado, atrasado) ainda é visto. */
const OVERLAP_24H = 24 * 60 * 60_000;
/** Depois de tantas falhas que não são do Gmail (e-mail ilegível), o id vira erro e deixa de travar a leitura. */
const MAX_ATTEMPTS = 3;

/** Só o cabeçalho (até a primeira linha em branco): o `mailparser` não precisa decodificar anexos aqui. */
function headerPart(raw: Buffer): Buffer {
  const crlf = raw.indexOf("\r\n\r\n");
  const lf = raw.indexOf("\n\n");
  const cut = [crlf, lf].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  return cut === undefined ? raw : raw.subarray(0, cut + 2);
}

/** Grava o `.eml` de forma atômica (temporário + rename): um arquivo cortado no meio nunca fica no lugar. */
function writeRaw(abs: string, raw: Buffer) {
  const tmp = `${abs}.tmp`;
  writeFileSync(tmp, raw, { mode: 0o600 });
  renameSync(tmp, abs);
}

/** Recusa do Gmail que só se resolve conectando de novo (escopo retirado, token revogado). */
const isAuthRefusal = (e: unknown) =>
  (e instanceof MailAuthError && e.code === "needs_reconnect") ||
  (e instanceof GmailApiError && (e.status === 401 || e.status === 403));

/**
 * Uma rodada da sincronização; `ctx` é a execução agendada (log, itens, contadores). Percorre a janela em fatias de
 * uma semana a partir do cursor, baixa até `fetchPerRun` e só avança o cursor quando a fatia inteira foi lida.
 */
export async function syncMail(input: {
  repos: Repos;
  dataDir: string;
  source: MailSource | null;
  ctx: Pick<ScheduledContext, "log" | "item" | "count" | "now" | "publish">;
  fetchPerRun?: number;
  listMax?: number;
}): Promise<MailSyncResult> {
  const { repos, ctx } = input;
  if (!input.source) {
    ctx.log("info", "Gmail não conectado: nada a ler");
    return { skipped: "not_connected", fetched: 0, caughtUp: false, errors: 0 };
  }
  const since = repos.settings.get<string>(MAIL_SINCE_KEY);
  if (!since) {
    ctx.log("warn", "Escolha em Configurações › Gmail quanto tempo para trás ler na primeira vez");
    return { skipped: "no_window", fetched: 0, caughtUp: false, errors: 0 };
  }
  const source = input.source;
  const nowMs = ctx.now.getTime();
  const sinceMs = Date.parse(since);
  const saved = repos.settings.get<MailCursor>(MAIL_CURSOR_KEY);
  let cursorMs = saved && saved.since === since ? Date.parse(saved.at) : sinceMs;
  const base = repos.settings.get<string>(MAIL_QUERY_KEY) ?? DEFAULT_MAIL_QUERY;
  const listMax = input.listMax ?? MAIL_LIST_MAX;
  const failures = repos.settings.get<Record<string, number>>(MAIL_FAILURES_KEY) ?? {};
  let budget = input.fetchPerRun ?? MAIL_FETCH_PER_RUN;
  let fetched = 0;
  let errors = 0;
  let caughtUp = false;
  mkdirSync(join(input.dataDir, MAIL_DIR), { recursive: true });

  const fail = async (e: unknown) => {
    if (isAuthRefusal(e)) {
      await markReconnect(repos, input.dataDir, ctx, e);
      throw e instanceof MailAuthError
        ? e
        : new MailAuthError("needs_reconnect", (e as Error).message);
    }
    throw e;
  };

  // pedidos da extensão primeiro, mesmo fora da busca e da janela
  const forced = (repos.settings.get<string[]>(MAIL_FORCE_KEY) ?? []).filter(
    (id) => !repos.mail.byGmailId(id),
  );

  const download = async (gmailId: string): Promise<"ok" | "gone" | "failed"> => {
    try {
      const m = await source.getRaw(gmailId);
      const rel = mailRawPath(gmailId);
      writeRaw(join(input.dataDir, rel), m.raw);
      const h = await parseMailHeaders(headerPart(m.raw));
      const receivedAt = new Date(m.internalDate);
      if (Number.isNaN(receivedAt.getTime())) throw new Error("data do e-mail inválida");
      repos.mail.insert(
        {
          gmailId,
          threadId: m.threadId,
          ...h,
          receivedAt: receivedAt.toISOString(),
          size: m.raw.length,
          labels: m.labelIds,
          rawPath: rel,
        },
        new Date().toISOString(),
      );
      delete failures[gmailId];
      fetched++;
      ctx.item({
        kind: "mail",
        refId: gmailId,
        label: h.subject ?? "(sem assunto)",
        action: "baixado",
        detail: h.fromAddr,
      });
      return "ok";
    } catch (e) {
      // 404: apagado entre a busca e o download; 400: id que o Gmail não aceita (pedido da extensão)
      if (e instanceof GmailApiError && (e.status === 404 || e.status === 400)) {
        ctx.log("info", `${gmailId} não existe mais no Gmail (${e.status}); pulado`);
        return "gone";
      }
      if (isAuthRefusal(e) || e instanceof GmailApiError || e instanceof MailAuthError)
        await fail(e);
      errors++;
      const n = (failures[gmailId] ?? 0) + 1;
      failures[gmailId] = n;
      const msg = e instanceof Error ? e.message : String(e);
      if (n >= MAX_ATTEMPTS) {
        const { record } = repos.mail.insert(
          {
            gmailId,
            threadId: null,
            fromAddr: null,
            fromName: null,
            replyTo: null,
            subject: null,
            receivedAt: new Date(nowMs).toISOString(),
            size: 0,
            labels: [],
            rawPath: mailRawPath(gmailId),
          },
          new Date().toISOString(),
        );
        repos.mail.setStatus(record.id, "error", new Date().toISOString(), { error: msg });
        delete failures[gmailId];
        ctx.log("error", `${gmailId} falhou ${n} vezes e fica como erro: ${msg}`);
        ctx.item({
          kind: "mail",
          refId: gmailId,
          label: gmailId,
          action: "falhou",
          result: "error",
          detail: msg,
        });
        return "gone";
      }
      ctx.log("warn", `Falha ao baixar ${gmailId} (tentativa ${n} de ${MAX_ATTEMPTS}): ${msg}`);
      ctx.item({
        kind: "mail",
        refId: gmailId,
        label: gmailId,
        action: "falhou",
        result: "error",
        detail: msg,
      });
      return "failed";
    }
  };

  try {
    const forcedLeft: string[] = [];
    for (const id of forced) {
      if (budget <= 0) {
        forcedLeft.push(id);
        continue;
      }
      budget--;
      if ((await download(id)) === "failed") forcedLeft.push(id);
    }
    // revisão do M3: o api pode ter acrescentado ids durante a rodada; tira só os tratados aqui
    if (forced.length) {
      const handled = new Set(forced.filter((id) => !forcedLeft.includes(id)));
      repos.db.exec("begin immediate");
      try {
        const now = repos.settings.get<string[]>(MAIL_FORCE_KEY) ?? [];
        repos.settings.set(
          MAIL_FORCE_KEY,
          now.filter((id) => !handled.has(id)),
        );
        repos.db.exec("commit");
      } catch (e) {
        repos.db.exec("rollback");
        throw e;
      }
    }
    while (budget > 0) {
      const fromMs = cursorMs > sinceMs ? Math.max(sinceMs, cursorMs - OVERLAP_24H) : sinceMs;
      const toMs = Math.min(cursorMs + SLICE_MS, nowMs + 60_000);
      const q = `${base} after:${Math.floor(fromMs / 1000)} before:${Math.ceil(toMs / 1000)}`;
      let ids: string[];
      try {
        ids = await source.listMessageIds(q, listMax);
      } catch (e) {
        await fail(e);
        return { fetched, caughtUp, errors };
      }
      if (ids.length >= listMax) {
        ctx.log(
          "warn",
          `Busca com ${ids.length}+ e-mails numa semana: refine a busca (mail.query); a leitura parou aqui`,
        );
        break;
      }
      const known = repos.mail.known(ids);
      // a busca devolve do mais novo para o mais antigo; a fila baixa do mais antigo (§2.2)
      const fresh = ids.filter((id) => !known.has(id)).reverse();
      let sliceDone = true;
      for (const gmailId of fresh) {
        if (budget <= 0) {
          sliceDone = false;
          break;
        }
        budget--;
        if ((await download(gmailId)) === "failed") sliceDone = false;
      }
      if (!sliceDone) break;
      cursorMs = toMs;
      if (toMs >= nowMs) {
        caughtUp = true;
        break;
      }
    }
  } finally {
    repos.settings.set(MAIL_FAILURES_KEY, failures);
    // compare-and-set: se a janela mudou durante a rodada (PUT do api), o cursor desta rodada não vale mais
    if (repos.settings.get<string>(MAIL_SINCE_KEY) === since)
      repos.settings.set(MAIL_CURSOR_KEY, {
        since,
        at: new Date(cursorMs).toISOString(),
      } satisfies MailCursor);
    ctx.count("fetched", fetched);
    if (errors) ctx.count("errors", errors);
  }
  if (caughtUp) {
    repos.settings.set(MAIL_LAST_SYNC_KEY, ctx.now.toISOString());
    ctx.log("info", `${fetched} e-mail(s) baixado(s); leitura em dia`);
  } else
    ctx.log(
      "info",
      `${fetched} e-mail(s) baixado(s); o resto da janela fica para a próxima execução`,
    );
  await resolveMailReconnect(repos, ctx.publish);
  return { fetched, caughtUp, errors };
}

/** Fecha a notificação "reconectar" (leitura voltou, conectou de novo ou desconectou). */
export async function resolveMailReconnect(repos: Repos, publish: ScheduledContext["publish"]) {
  for (const n of repos.notifications.resolveSubject("mail", "gmail", ["mail.reconnect"]))
    await publish({ type: "notification.updated", notification: n });
}

async function markReconnect(
  repos: Repos,
  dataDir: string,
  ctx: Pick<ScheduledContext, "publish">,
  e: unknown,
) {
  // 401/403 da API com o refresh ainda válido: marca o token, para o status pedir "Reconectar" também
  if (e instanceof GmailApiError) {
    const t = readGmailToken(dataDir);
    if (t && !t.invalidAt)
      writeGmailToken(dataDir, {
        ...t,
        invalidAt: new Date().toISOString(),
        invalidReason: e.message,
      });
  }
  await notifyReconnect(repos, ctx);
}

async function notifyReconnect(repos: Repos, ctx: Pick<ScheduledContext, "publish">) {
  const { notification, created } = repos.notifications.upsert({
    kind: "mail.reconnect",
    subjectKind: "mail",
    subjectId: "gmail",
    title: "O Google recusou o acesso ao Gmail",
    body: "O login expirou ou foi revogado. Conecte o Gmail de novo em Configurações para continuar lendo os e-mails.",
    actionUrl: "/configuracoes",
    severity: "warning",
  });
  await ctx.publish({
    type: created ? "notification.created" : "notification.updated",
    notification,
  });
}
