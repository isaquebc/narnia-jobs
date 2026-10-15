import {
  confirmPostingNote,
  editPostingNote,
  type NoteEditResult,
  type Repos,
  rejectPostingNote,
} from "@narnia-jobs/core";
import {
  PostingContactInputSchema,
  PostingCreateSchema,
  PostingNoteInputSchema,
  PostingPatchSchema,
} from "@narnia-jobs/shared";
import { Hono } from "hono";
import { apiError } from "../errors";
import type { EventBus } from "../events";
import { validate } from "./validate";

/**
 * Vagas (F06 §2.7, M2): CRUD da vaga, contatos e notas. A extração (M4) e a análise (M5) entram depois. Toda escrita
 * emite `posting.updated`; a nota pendente do recrutador (F06-17) vira pendência em Pendências e na bandeja.
 */
export function postingsRoutes(deps: { repos: Repos; bus?: EventBus }) {
  const app = new Hono();
  const { repos } = deps;
  const touched = (postingId: string) => deps.bus?.emit({ type: "posting.updated", postingId });
  const relay = (r: NoteEditResult) => {
    for (const ev of r.notifications)
      deps.bus?.emit({
        type: ev.created ? "notification.created" : "notification.updated",
        notification: ev.notification,
      });
    touched(r.note.postingId);
    return r;
  };
  const notFound = (c: Parameters<typeof apiError>[0]) =>
    apiError(c, 404, "posting_not_found", "Vaga não encontrada");

  app.get("/api/postings", (c) => c.json({ postings: repos.postings.list() }));

  app.post("/api/postings", validate("json", PostingCreateSchema), (c) => {
    const posting = repos.postings.create(c.req.valid("json"), { source: "user" });
    touched(posting.id);
    return c.json({ posting }, 201);
  });

  app.get("/api/postings/:id", (c) => {
    const posting = repos.postings.get(c.req.param("id"));
    if (!posting) return notFound(c);
    return c.json({
      posting,
      contacts: repos.postingContacts.list(posting.id),
      notes: repos.postingNotes.list(posting.id),
      duplicates: posting.identityHash
        ? repos.postings.findByIdentity(posting.identityHash, posting.id).map((p) => p.id)
        : [],
    });
  });

  app.patch("/api/postings/:id", validate("json", PostingPatchSchema), (c) => {
    const id = c.req.param("id");
    if (!repos.postings.get(id)) return notFound(c);
    const posting = repos.postings.update(id, c.req.valid("json"), { source: "user" });
    touched(id);
    return c.json({ posting });
  });

  app.delete("/api/postings/:id", (c) => {
    const id = c.req.param("id");
    if (!repos.postings.get(id)) return notFound(c);
    for (const n of repos.postingNotes.list(id))
      repos.notifications.resolveSubject("posting_note", n.id, ["posting.note_pending"]);
    repos.postings.remove(id);
    touched(id);
    return c.body(null, 204);
  });

  /* contatos */
  app.post("/api/postings/:id/contacts", validate("json", PostingContactInputSchema), (c) => {
    const id = c.req.param("id");
    if (!repos.postings.get(id)) return notFound(c);
    const contact = repos.postingContacts.add(id, c.req.valid("json"));
    touched(id);
    return c.json({ contact }, 201);
  });
  app.patch(
    "/api/postings/:id/contacts/:contactId",
    validate("json", PostingContactInputSchema.partial()),
    (c) => {
      const cur = repos.postingContacts.get(c.req.param("contactId"));
      if (!cur || cur.postingId !== c.req.param("id"))
        return apiError(c, 404, "contact_not_found", "Contato não encontrado");
      const contact = repos.postingContacts.update(cur.id, c.req.valid("json"));
      touched(cur.postingId);
      return c.json({ contact });
    },
  );
  app.delete("/api/postings/:id/contacts/:contactId", (c) => {
    const cur = repos.postingContacts.get(c.req.param("contactId"));
    if (!cur || cur.postingId !== c.req.param("id"))
      return apiError(c, 404, "contact_not_found", "Contato não encontrado");
    repos.postingContacts.remove(cur.id);
    touched(cur.postingId);
    return c.body(null, 204);
  });

  /* notas: a web escreve como usuário; o recrutador escreve pelas tools (M5) */
  const noteOf = (c: { req: { param: (k: string) => string } }) => {
    const n = repos.postingNotes.get(c.req.param("noteId"));
    return n && n.postingId === c.req.param("id") ? n : null;
  };
  app.post("/api/postings/:id/notes", validate("json", PostingNoteInputSchema), (c) => {
    const id = c.req.param("id");
    if (!repos.postings.get(id)) return notFound(c);
    const note = repos.postingNotes.add(id, "user", c.req.valid("json").body);
    touched(id);
    return c.json({ note }, 201);
  });
  app.patch("/api/postings/:id/notes/:noteId", validate("json", PostingNoteInputSchema), (c) => {
    const n = noteOf(c);
    if (!n) return apiError(c, 404, "note_not_found", "Nota não encontrada");
    const r = relay(editPostingNote(repos, n.id, "user", c.req.valid("json").body));
    return c.json({ note: r.note });
  });
  app.post("/api/postings/:id/notes/:noteId/confirm", (c) => {
    const n = noteOf(c);
    if (!n) return apiError(c, 404, "note_not_found", "Nota não encontrada");
    return c.json({ note: relay(confirmPostingNote(repos, n.id)).note });
  });
  app.post("/api/postings/:id/notes/:noteId/reject", (c) => {
    const n = noteOf(c);
    if (!n) return apiError(c, 404, "note_not_found", "Nota não encontrada");
    return c.json({ note: relay(rejectPostingNote(repos, n.id)).note });
  });
  app.delete("/api/postings/:id/notes/:noteId", (c) => {
    const n = noteOf(c);
    if (!n) return apiError(c, 404, "note_not_found", "Nota não encontrada");
    repos.notifications.resolveSubject("posting_note", n.id, ["posting.note_pending"]);
    repos.postingNotes.remove(n.id);
    touched(n.postingId);
    return c.body(null, 204);
  });

  /** Edições do recrutador esperando o usuário (bandeja "Aguardando você", F06-17). */
  app.get("/api/postings-pending-notes", (c) =>
    c.json({
      notes: repos.postingNotes.listPending().map((note) => {
        const p = repos.postings.get(note.postingId);
        return {
          note,
          posting: p ? { id: p.id, company: p.company, title: p.title, role: p.role } : null,
        };
      }),
    }),
  );

  return app;
}
