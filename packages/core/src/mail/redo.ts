import type { Posting } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import { withTransaction } from "../db/open";
import { MailUndoError, undoMail } from "./undo";

/**
 * Desfazer e refazer a leitura dos e-mails (pedido do dono 2026-11-11, para testar o processamento novo): tudo que as
 * leituras escolhidas fizeram volta e os e-mails voltam para a fila, do começo (risco, pré-filtro, classe); a próxima
 * leitura processa de novo. Os `.eml` ficam (nada é baixado de novo) e as etiquetas que o Gmail já tem também.
 *
 * O que a pessoa já usou fica: candidatura em que ela acrescentou algo (o e-mail dela fica como está, avisado em
 * `kept`) e vaga do feed com interação, candidatura, documento, análise, contato ou nota.
 */
export class MailRedoError extends Error {
  constructor(
    readonly code: "not_found" | "wrong_task" | "running",
    message: string,
  ) {
    super(message);
  }
}

export interface MailRedoResult {
  /** E-mails devolvidos à fila. */
  mails: number;
  applicationsRemoved: number;
  postingsRemoved: number;
  /** E-mails que ficaram como estavam, com o motivo. */
  kept: Array<{ gmailId: string; subject: string | null; reason: string }>;
}

/** Trava do desfazer e refazer: a leitura agendada não começa enquanto ela existe (revisão: corrida com o worker). */
export const MAIL_REDO_LOCK_KEY = "mail.redoLock";
/** Trava mais velha que isso é de um processo que caiu: não vale mais. */
const LOCK_TTL_MS = 10 * 60_000;

export function mailRedoLocked(repos: Repos, now = new Date()): boolean {
  const at = repos.settings.get<string>(MAIL_REDO_LOCK_KEY);
  return !!at && now.getTime() - Date.parse(at) < LOCK_TTL_MS;
}

/** Vaga do feed que ninguém usou: dá para apagar sem perder nada da pessoa. */
function untouched(repos: Repos, p: Posting): boolean {
  const chat = repos.db
    .prepare("select 1 as x from chat_session where posting_id = ? limit 1")
    .get(p.id);
  return (
    p.source === "email" &&
    !p.lastInteractionAt &&
    !p.archiveReason &&
    !p.autoAnalysisAt &&
    p.status !== "extracting" &&
    !chat &&
    !repos.jobApplications.latestForPosting(p.id) &&
    !repos.documents.list({ postingId: p.id }).length &&
    !repos.jobAnalyses.latest(p.id) &&
    !repos.postingContacts.list(p.id).length &&
    !repos.postingNotes.list(p.id).length
  );
}

/** Desfaz a leitura `runId` e todas as seguintes da tarefa `mail.sync`. */
export function redoMailRuns(
  repos: Repos,
  dataDir: string,
  runId: string,
  now = new Date(),
): MailRedoResult {
  const run = repos.scheduled.run(runId);
  if (!run) throw new MailRedoError("not_found", "Execução não encontrada");
  if (run.taskId !== "mail.sync")
    throw new MailRedoError("wrong_task", "Só dá para refazer a leitura de e-mails");
  // a trava e a conferência de "rodando" juntas, numa transação de escrita (o worker é outro processo)
  repos.db.exec("begin immediate");
  try {
    if (repos.scheduled.isRunning("mail.sync") || mailRedoLocked(repos, now))
      throw new MailRedoError("running", "A leitura de e-mails está rodando; espere ela terminar");
    repos.settings.set(MAIL_REDO_LOCK_KEY, now.toISOString());
    repos.db.exec("commit");
  } catch (e) {
    repos.db.exec("rollback");
    throw e;
  }
  try {
    return redoLocked(repos, dataDir, run.startedAt, now);
  } finally {
    repos.settings.set(MAIL_REDO_LOCK_KEY, null);
  }
}

function redoLocked(
  repos: Repos,
  dataDir: string,
  fromStartedAt: string,
  now: Date,
): MailRedoResult {
  const runs = repos.scheduled
    .runs("mail.sync", 10_000)
    .filter((r) => r.startedAt >= fromStartedAt);
  const ids = new Set<string>();
  for (const r of runs)
    for (const it of repos.scheduled.run(r.id)?.items ?? [])
      if (it.kind === "mail" && it.refId) ids.add(it.refId);
  // do mais novo para o mais antigo: a negativa sai antes da confirmação que criou a candidatura
  const mails = [...ids]
    .map((g) => repos.mail.byGmailId(g))
    .filter((m): m is NonNullable<typeof m> => !!m)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const at = now.toISOString();
  const out: MailRedoResult = { mails: 0, applicationsRemoved: 0, postingsRemoved: 0, kept: [] };
  for (const msg of mails) {
    const keep = (reason: string) =>
      out.kept.push({ gmailId: msg.gmailId, subject: msg.subject, reason });
    // o que a pessoa decidiu fica (revisão): desfeito por ela, ou vaga escolhida e "aplicar mesmo assim" na revisão
    if (msg.undoneAt) {
      keep("você já tinha desfeito este e-mail");
      continue;
    }
    const decided = msg.result as { forcedPostingId?: string; confirmed?: boolean } | null;
    if (decided?.forcedPostingId || decided?.confirmed) {
      keep("você decidiu este e-mail na revisão");
      continue;
    }
    try {
      withTransaction(repos.db, () => {
        if (msg.status === "done" && msg.undo && !msg.undoneAt) {
          const u = undoMail(repos, dataDir, msg.id, now);
          if (u.applicationRemoved) out.applicationsRemoved++;
        }
        // vagas que o alerta criou (a origem aponta para ele) e que ninguém usou
        const postings = (msg.result as { postings?: string[] } | null)?.postings ?? [];
        for (const pid of postings) {
          const p = repos.postings.get(pid);
          if (!p || p.sourceRef?.gmailId !== msg.gmailId || !untouched(repos, p)) continue;
          repos.postings.remove(pid);
          out.postingsRemoved++;
        }
        repos.mail.resetForRedo(msg.id, at);
      });
      out.mails++;
    } catch (e) {
      // erro num e-mail não para os outros (revisão): ele fica como estava, com o motivo
      if (e instanceof MailUndoError)
        keep(e.details.length ? `a candidatura já tem ${e.details.join(", ")}` : e.message);
      else keep(`não deu para desfazer: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}
