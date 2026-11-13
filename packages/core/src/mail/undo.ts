import { rmSync } from "node:fs";
import { join } from "node:path";
import type { Repos } from "../db";
import { withTransaction } from "../db/open";
import { removeJobApplication } from "../job-applications/entries";

/** Apaga uma vaga criada por e-mail com os arquivos dos documentos dela (as linhas caem em cascata). */
export function removeMailPosting(repos: Repos, dataDir: string, id: string): void {
  for (const n of repos.postingNotes.list(id))
    repos.notifications.resolveSubject("posting_note", n.id, ["posting.note_pending"]);
  for (const d of repos.documents.list({ postingId: id })) {
    repos.notifications.resolveSubject("document", d.id);
    rmSync(join(dataDir, "documents", d.id), { recursive: true, force: true });
  }
  repos.postings.remove(id);
}

export class MailUndoError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "not_done"
      | "already_undone"
      | "nothing_to_undo"
      | "has_dependents",
    message: string,
    /** has_dependents: o que já existe na candidatura além do que o e-mail criou. */
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

export interface MailUndoResult {
  applicationId: string | null;
  postingId: string | null;
  /** A candidatura criada pelo e-mail foi apagada. */
  applicationRemoved: boolean;
  /** O que não voltou porque mudou depois do e-mail (por outra mensagem ou pela pessoa). */
  skipped: string[];
  /** Sugestões que saíram (para a notificação agrupada). */
  touchedApplications: string[];
}

/**
 * Desfaz o que um e-mail fez (F14/M6): apaga o que ele criou (notas, eventos, sugestões abertas e, se nada mais foi
 * acrescentado, a candidatura e a vaga) e devolve o que ele mudou (etapa, encerramento, eventos remarcados ou
 * cancelados) — **só o que ainda está como o e-mail deixou**: o que mudou depois fica e vai em `skipped`.
 * Movimento automático ou sugestão aprovada desfeita conta como erro no aprendizado (§2.4) e esfria o automático.
 * A etiqueta `narnia-jobs` fica no Gmail (o e-mail foi lido; só a ação saiu).
 */
export function undoMail(
  repos: Repos,
  dataDir: string,
  mailId: string,
  now = new Date(),
  /**
   * Desfazer as leituras (pedido do dono 2026-11-12, "tudo deve ser limpo"): apaga a candidatura e a vaga criadas pelo
   * e-mail mesmo com o que a pessoa acrescentou depois. Vaga que já existia antes do e-mail nunca sai.
   */
  opts: { force?: boolean } = {},
): MailUndoResult {
  const msg = repos.mail.get(mailId);
  if (!msg) throw new MailUndoError("not_found", "E-mail não encontrado");
  if (msg.undoneAt) throw new MailUndoError("already_undone", "Este e-mail já foi desfeito");
  if (msg.status !== "done") throw new MailUndoError("not_done", "Este e-mail não foi aplicado");
  const u = msg.undo;
  if (!u) throw new MailUndoError("nothing_to_undo", "Nada para desfazer neste e-mail");
  const at = now.toISOString();
  const result = msg.result as { applicationId?: string; postingId?: string } | null;
  const skipped: string[] = [];
  const touched = new Set<string>();

  // candidatura criada pelo e-mail: só apaga se ela tem apenas o que o e-mail criou (revisão do M6, #5)
  if (!opts.force && u.createdApplicationId && repos.jobApplications.get(u.createdApplicationId)) {
    const id = u.createdApplicationId;
    const own = new Set(u.entryIds ?? []);
    const details: string[] = [];
    const notes = repos.jobApplicationEntries.list(id).filter((e) => !own.has(e.id)).length;
    if (notes) details.push(`${notes} nota(s)`);
    const events = repos.jobApplicationEvents.list(id).length;
    if (events) details.push(`${events} evento(s) na agenda`);
    const mails = repos.mail
      .forApplication(id)
      .filter((m) => m.id !== mailId && !m.undoneAt).length;
    if (mails) details.push(`${mails} outro(s) e-mail(s)`);
    const recordings = repos.recordings.listByApplication(id).length;
    if (recordings) details.push(`${recordings} gravação(ões)`);
    if (details.length)
      throw new MailUndoError(
        "has_dependents",
        `A candidatura já tem ${details.join(", ")}; apague-a pela página dela se quiser`,
        details,
      );
  }

  return withTransaction(repos.db, () => {
    const ev = repos.jobApplicationEvents;
    for (const p of [...(u.eventPrev ?? [])].reverse()) {
      const cur = ev.get(p.id);
      if (!cur) continue;
      if (cur.startsAt !== p.afterStartsAt || cur.cancelledAt !== p.afterCancelledAt) {
        skipped.push(`evento "${cur.title}" (mudou depois)`);
        continue;
      }
      ev.update(p.id, {
        title: p.title,
        startsAt: p.startsAt,
        durationMin: p.durationMin,
        timezone: p.timezone,
        location: p.location,
        link: p.link,
      });
      ev.setMail(p.id, {
        provisional: p.provisional,
        icsUid: p.icsUid,
        mailMessageId: p.mailMessageId,
        remoteSequence: p.remoteSequence,
      });
      ev.setCancelled(p.id, p.cancelledAt);
    }
    for (const id of u.eventIds ?? []) if (ev.get(id)) ev.remove(id);
    for (const id of u.suggestionIds ?? []) {
      const s = repos.stageSuggestions.get(id);
      if (!s) continue;
      touched.add(s.applicationId);
      // automático ou aprovada desfeita = erro; sugestão ainda aberta sai sem contar (não foi decisão de ninguém)
      if (s.decision === null && s.mode === "suggested") repos.stageSuggestions.remove(id);
      else if (s.decision !== "rejected") repos.stageSuggestions.decide(id, "undone", at);
    }
    if (u.stage) {
      const cur = repos.jobApplications.get(u.stage.applicationId);
      if (cur && cur.currentStageId === u.stage.toStageId)
        repos.jobApplications.setCurrentStage(u.stage.applicationId, u.stage.fromStageId, now, {
          source: "undo",
          mailMessageId: mailId,
        });
      else if (cur) skipped.push("etapa (mudou depois)");
    }
    // F15-6: as etapas voltam às de antes, se ainda estão como o e-mail deixou
    if (u.stages) {
      const cur = repos.jobApplications.get(u.stages.applicationId);
      if (cur && cur.stages.map((s) => s.name).join("\n") === u.stages.after.join("\n")) {
        const back = repos.jobApplications.setStages(
          cur.id,
          u.stages.before.map((name) => ({ name })),
          now,
        );
        const stage = back.stages.find((s) => s.name === u.stages?.beforeCurrent);
        if (stage && back.currentStageId !== stage.id)
          repos.jobApplications.setCurrentStage(cur.id, stage.id, now, {
            source: "undo",
            mailMessageId: mailId,
          });
      } else if (cur) skipped.push("etapas (mudaram depois)");
    }
    // F15: tarefas do e-mail; a que a pessoa já moveu fica (no desfazer das leituras, sai também)
    for (const id of u.todoIds ?? []) {
      const t = repos.todos.get(id);
      if (!t) continue;
      if (!opts.force && t.status !== "todo") {
        skipped.push(`tarefa "${t.title}" (você já mexeu nela)`);
        continue;
      }
      repos.todos.remove(id);
      repos.notifications.resolveSubject("todo", id);
    }
    if (u.closed) {
      const cur = repos.jobApplications.get(u.closed.applicationId);
      const mine = new Set(u.entryIds ?? []);
      if (cur && cur.column === "closed" && cur.closedEntryId && mine.has(cur.closedEntryId)) {
        // reabre como estava antes da negativa (as linhas de passagem continuam no histórico)
        repos.jobApplications.update(
          u.closed.applicationId,
          {
            column: u.closed.column as never,
            closedReason: u.closed.closedReason as never,
            closedStage: u.closed.closedStage,
            closedEntryId: u.closed.closedEntryId,
          },
          now,
        );
      } else if (cur) skipped.push("encerramento (a candidatura mudou depois)");
    }
    for (const id of u.entryIds ?? []) {
      const e = repos.jobApplicationEntries.get(id);
      if (!e) continue;
      // nota que ainda segura o encerramento (pulado acima) fica
      const holder = repos.jobApplications.get(e.applicationId)?.closedEntryId === id;
      if (!holder) repos.jobApplicationEntries.remove(id);
    }
    let applicationRemoved = false;
    if (u.createdApplicationId && repos.jobApplications.get(u.createdApplicationId)) {
      removeJobApplication(repos, dataDir, u.createdApplicationId);
      applicationRemoved = true;
    }
    const pid = u.createdPostingId;
    if (pid && repos.postings.get(pid) && !repos.jobApplications.latestForPosting(pid)) {
      if (opts.force) removeMailPosting(repos, dataDir, pid);
      else if (!repos.documents.list({ postingId: pid }).length && !repos.jobAnalyses.latest(pid))
        repos.postings.remove(pid);
      else skipped.push("vaga (tem documentos ou análise)");
    } else if (pid && repos.postings.get(pid)) skipped.push("vaga (tem outra candidatura)");
    repos.mail.markUndone(mailId, at);
    return {
      applicationId: applicationRemoved ? null : (result?.applicationId ?? null),
      postingId: result?.postingId ?? null,
      applicationRemoved,
      skipped,
      touchedApplications: [...touched],
    };
  });
}
