import type { Repos } from "../db";
import { withTransaction } from "../db/open";
import { removeJobApplication } from "../job-applications/entries";
import { removeMailPosting, undoMail } from "./undo";

/**
 * Desfazer as leituras de e-mails (pedido do dono 2026-11-11, regras de 2026-11-12, para testar o processamento
 * novo): **tudo** que as leituras escolhidas criaram sai, mesmo o que a pessoa já usou (candidatura com notas, vaga
 * aberta, analisada ou arquivada), e os e-mails voltam para a fila, do começo (risco, pré-filtro, classe). Vaga que já
 * existia antes da leitura nunca sai: dela só sai o que o e-mail criou (candidatura, nota, sugestão).
 *
 * Nada é lido de novo sozinho: a leitura agendada fica pausada e a pessoa clica em "Rodar agora" quando quiser. Os
 * `.eml` ficam (nada é baixado de novo) e as etiquetas que o Gmail já tem também.
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
  /** E-mails que deram erro ao desfazer (ficaram como estavam), com o motivo. */
  kept: Array<{ gmailId: string; subject: string | null; reason: string }>;
}

/** Trava do desfazer: a leitura não começa enquanto ela existe (revisão: corrida com o worker). */
export const MAIL_REDO_LOCK_KEY = "mail.redoLock";
/** Trava mais velha que isso é de um processo que caiu: não vale mais. */
const LOCK_TTL_MS = 10 * 60_000;

export function mailRedoLocked(repos: Repos, now = new Date()): boolean {
  const at = repos.settings.get<string>(MAIL_REDO_LOCK_KEY);
  return !!at && now.getTime() - Date.parse(at) < LOCK_TTL_MS;
}

/**
 * Desfaz a leitura `runId` e todas as seguintes da tarefa `mail.sync`; sem `runId`, todas as leituras. A leitura
 * agendada fica pausada.
 */
export function redoMailRuns(
  repos: Repos,
  dataDir: string,
  runId: string | null,
  now = new Date(),
): MailRedoResult {
  let from = "";
  if (runId) {
    const run = repos.scheduled.run(runId);
    if (!run) throw new MailRedoError("not_found", "Execução não encontrada");
    if (run.taskId !== "mail.sync")
      throw new MailRedoError("wrong_task", "Só dá para desfazer a leitura de e-mails");
    from = run.startedAt;
  }
  // a trava e a conferência de "rodando" juntas, numa transação de escrita (o worker é outro processo)
  repos.db.exec("begin immediate");
  try {
    if (repos.scheduled.isRunning("mail.sync") || mailRedoLocked(repos, now))
      throw new MailRedoError("running", "A leitura de e-mails está rodando; espere ela terminar");
    repos.settings.set(MAIL_REDO_LOCK_KEY, now.toISOString());
    // a pessoa decide quando ler de novo (pedido do dono 2026-11-12)
    repos.scheduled.setTask("mail.sync", { paused: true }, now.toISOString());
    repos.db.exec("commit");
  } catch (e) {
    repos.db.exec("rollback");
    throw e;
  }
  try {
    return undoLocked(repos, dataDir, from, now);
  } finally {
    repos.settings.set(MAIL_REDO_LOCK_KEY, null);
  }
}

function undoLocked(repos: Repos, dataDir: string, from: string, now: Date): MailRedoResult {
  const runs = repos.scheduled.runs("mail.sync", 10_000).filter((r) => r.startedAt >= from);
  const ids = new Set<string>();
  for (const r of runs)
    for (const it of repos.scheduled.run(r.id)?.items ?? [])
      if (it.kind === "mail" && it.refId) ids.add(it.refId);
  // do mais novo para o mais antigo: a negativa sai antes da confirmação que criou a candidatura
  const mails = [...ids]
    .map((g) => repos.mail.byGmailId(g))
    .filter((m): m is NonNullable<typeof m> => !!m)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const out: MailRedoResult = { mails: 0, applicationsRemoved: 0, postingsRemoved: 0, kept: [] };
  for (const msg of mails) undoOne(repos, dataDir, msg, now, out);
  return out;
}

type MailRecord = NonNullable<ReturnType<Repos["mail"]["get"]>>;

/** Desfaz tudo o que um e-mail criou e o devolve à fila, do começo; erro fica em `kept`. */
function undoOne(repos: Repos, dataDir: string, msg: MailRecord, now: Date, out: MailRedoResult) {
  const at = now.toISOString();
  try {
    withTransaction(repos.db, () => {
      if (msg.status === "done" && msg.undo && !msg.undoneAt) {
        const hadPosting = msg.undo.createdPostingId
          ? !!repos.postings.get(msg.undo.createdPostingId)
          : false;
        const u = undoMail(repos, dataDir, msg.id, now, { force: true });
        if (u.applicationRemoved) out.applicationsRemoved++;
        if (hadPosting && !repos.postings.get(msg.undo.createdPostingId as string))
          out.postingsRemoved++;
      }
      // vagas que o e-mail criou, pela origem gravada na vaga (o resultado do e-mail some num desfazer anterior que
      // deixou vagas para trás: 2026-11-12); as que já existiam têm outra origem e ficam
      for (const p of repos.postings.fromMail(msg.gmailId)) {
        const pid = p.id;
        // candidatura criada por e-mail nesta vaga sai junto; a feita pela pessoa segura a vaga
        const apps = repos.jobApplications.list().filter((a) => a.postingId === pid);
        if (apps.some((a) => a.source !== "email")) continue;
        for (const a of apps) {
          removeJobApplication(repos, dataDir, a.id);
          out.applicationsRemoved++;
        }
        removeMailPosting(repos, dataDir, pid);
        out.postingsRemoved++;
      }
      repos.mail.resetForRedo(msg.id, at);
    });
    out.mails++;
  } catch (e) {
    // erro num e-mail não para os outros (revisão): ele fica como estava, com o motivo
    out.kept.push({
      gmailId: msg.gmailId,
      subject: msg.subject,
      reason: `não deu para desfazer: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

/**
 * "Ler de novo este e-mail" (pedido do dono 2026-11-12, para testar a leitura nova num e-mail só): desfaz tudo o que
 * ele criou (mesmo o já usado) e o devolve à fila do começo; a leitura agendada **não** pausa, e quem chama roda a
 * leitura logo depois.
 */
export function rereadMail(
  repos: Repos,
  dataDir: string,
  mailId: string,
  now = new Date(),
): MailRedoResult {
  const msg = repos.mail.get(mailId);
  if (!msg) throw new MailRedoError("not_found", "E-mail não encontrado");
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
    const out: MailRedoResult = { mails: 0, applicationsRemoved: 0, postingsRemoved: 0, kept: [] };
    undoOne(repos, dataDir, msg, now, out);
    return out;
  } finally {
    repos.settings.set(MAIL_REDO_LOCK_KEY, null);
  }
}
