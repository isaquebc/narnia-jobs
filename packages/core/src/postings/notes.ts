import type { NoteAuthor, Notification, PostingNote } from "@narnia-jobs/shared";
import type { Repos } from "../db";

/**
 * Notas da vaga (F06 §1.3, F06-17): edição do recrutador numa nota do usuário espera confirmação. A pendência aparece
 * na bandeja ("Aguardando você") e em Pendências; confirmar ou recusar resolve a pendência. Quem emite os eventos WS é
 * a api, com o que esta função devolve.
 */
export interface NoteEditResult {
  note: PostingNote;
  pending: boolean;
  notifications: Array<{ notification: Notification; created: boolean }>;
}

const SUBJECT = "posting_note";

export function editPostingNote(
  repos: Repos,
  noteId: string,
  by: NoteAuthor,
  body: string,
): NoteEditResult {
  const { note, pending } = repos.postingNotes.edit(noteId, by, body);
  if (!pending) {
    return { note, pending, notifications: resolved(repos, noteId) };
  }
  const posting = repos.postings.get(note.postingId);
  const name = [posting?.company, posting?.title ?? posting?.role].filter(Boolean).join(" · ");
  const ev = repos.notifications.upsert({
    kind: "posting.note_pending",
    subjectKind: SUBJECT,
    subjectId: noteId,
    title: `O recrutador quer alterar uma nota${name ? ` em ${name}` : ""}`,
    body: note.pendingBody,
    actionUrl: `/vagas/${note.postingId}?nota=${noteId}`,
    severity: "info",
  });
  return { note, pending, notifications: [ev] };
}

export function confirmPostingNote(repos: Repos, noteId: string): NoteEditResult {
  const note = repos.postingNotes.confirm(noteId);
  return { note, pending: false, notifications: resolved(repos, noteId) };
}

export function rejectPostingNote(repos: Repos, noteId: string): NoteEditResult {
  const note = repos.postingNotes.reject(noteId);
  return { note, pending: false, notifications: resolved(repos, noteId) };
}

function resolved(repos: Repos, noteId: string) {
  return repos.notifications
    .resolveSubject(SUBJECT, noteId, ["posting.note_pending"])
    .map((notification) => ({ notification, created: false }));
}
