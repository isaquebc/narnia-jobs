import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  analysisStale,
  buildPreAnalysis,
  confirmPostingNote,
  decideDuplicate,
  duplicatePostings,
  editPostingNote,
  evidenceLabels,
  type NoteEditResult,
  postingApplicationRef,
  type Repos,
  rejectPostingNote,
  relatedPostings,
  searchPostings,
} from "@narnia-jobs/core";
import {
  JobAnalysisSchema,
  PostingArchiveRequestSchema,
  PostingContactInputSchema,
  PostingCreateSchema,
  PostingFieldsSchema,
  PostingNoteInputSchema,
  PostingPatchSchema,
} from "@narnia-jobs/shared";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { apiError } from "../errors";
import type { EventBus } from "../events";
import type { FetchPostingOptions } from "../postings/fetch";
import type { QueueAdapter } from "../queue";
import { enqueueExtraction, intakePosting } from "../services/postings";
import { validate } from "./validate";

const IntakeSchema = z
  .object({
    text: z.string().max(100_000).optional(),
    url: z.url().optional(),
    fields: PostingFieldsSchema.partial().optional(),
  })
  .refine(
    (v) => Boolean(v.text?.trim() || v.url || v.fields),
    "Informe o texto, o link ou algum dado da vaga.",
  );
const DuplicateDecisionSchema = z.object({ action: z.enum(["update", "new", "cancel"]) });
const INTAKE_STATUS = {
  text_too_short: 422,
  empty: 400,
  invalid_url: 400,
  extract_failed: 422,
  blocked_page: 422,
} as const;

/**
 * Vagas (F06 §2.7, M2): CRUD da vaga, contatos e notas. A extração (M4) e a análise (M5) entram depois. Toda escrita
 * emite `posting.updated`; a nota pendente do recrutador (F06-17) vira pendência em Pendências e na bandeja.
 */
export function postingsRoutes(deps: {
  repos: Repos;
  bus?: EventBus;
  queue?: QueueAdapter;
  dataDir?: string;
  fetchOptions?: FetchPostingOptions;
}) {
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

  // busca por texto (empresa, cliente, cargo, role, contatos); sem `q`, todas
  // F07: cada vaga com a candidatura dela (destaque das aplicadas); arquivadas só com `archived=1`
  app.get("/api/postings", (c) =>
    c.json({
      postings: searchPostings(repos, c.req.query("q") ?? "", {
        archived: c.req.query("archived") === "1",
      }).map((p) => ({ ...p, application: postingApplicationRef(repos, p.id) })),
    }),
  );

  // F07 (pedido do dono 2026-10-27): arquivar a vaga que não deu um bom fit, com o motivo
  app.post("/api/postings/:id/archive", validate("json", PostingArchiveRequestSchema), (c) => {
    const id = c.req.param("id");
    if (!repos.postings.get(id)) return notFound(c);
    if (repos.jobApplications.activeForPosting(id))
      return apiError(c, 409, "has_active_application", "Há uma candidatura ativa nesta vaga");
    const b = c.req.valid("json");
    repos.postings.setArchived(id, { reason: b.reason, note: b.note?.trim() || null });
    touched(id);
    return c.json({ posting: repos.postings.get(id) });
  });

  app.post("/api/postings/:id/unarchive", (c) => {
    const id = c.req.param("id");
    if (!repos.postings.get(id)) return notFound(c);
    repos.postings.setArchived(id, null);
    touched(id);
    return c.json({ posting: repos.postings.get(id) });
  });

  app.post("/api/postings", validate("json", PostingCreateSchema), (c) => {
    const posting = repos.postings.create(c.req.valid("json"), { source: "user" });
    touched(posting.id);
    return c.json({ posting }, 201);
  });

  // entrada pelo texto ou pelo link (F06 §2.1): heurística na hora, extração pelo modelo na fila
  app.post("/api/postings/intake", validate("json", IntakeSchema), async (c) => {
    if (!deps.queue || !deps.dataDir)
      return apiError(c, 503, "queue_unavailable", "Fila indisponível");
    const b = c.req.valid("json");
    const r = await intakePosting(
      {
        repos,
        queue: deps.queue,
        dataDir: deps.dataDir,
        bus: deps.bus,
        fetchOptions: deps.fetchOptions,
      },
      { text: b.text ?? null, url: b.url ?? null, fields: b.fields ?? {} },
    );
    if (!r.ok)
      return apiError(
        c,
        (INTAKE_STATUS as Record<string, 400 | 422>)[r.code] ?? 422,
        r.code,
        r.message,
      );
    return c.json({ posting: r.posting, job: r.job }, 201);
  });

  // decisão do modal de duplicata (F06-9)
  app.post(
    "/api/postings/:id/duplicate-decision",
    validate("json", DuplicateDecisionSchema),
    (c) => {
      const id = c.req.param("id");
      const p = repos.postings.get(id);
      if (!p) return notFound(c);
      if (!p.duplicate || p.duplicate.decision !== null)
        return apiError(c, 409, "no_pending_duplicate", "Esta vaga não tem duplicata pendente.");
      const r = decideDuplicate(repos, id, c.req.valid("json").action);
      if (r.keptId) touched(r.keptId);
      if (r.removedId) touched(r.removedId);
      // descartada a nova, a salva também avisa: a janela da extensão passou a acompanhar ela
      if (!r.keptId) touched(p.duplicate.candidateId);
      return c.json(r);
    },
  );

  // refazer a extração (depois de editar a JD, ou depois de erro)
  app.post("/api/postings/:id/extract", async (c) => {
    if (!deps.queue || !deps.dataDir)
      return apiError(c, 503, "queue_unavailable", "Fila indisponível");
    const p = repos.postings.get(c.req.param("id"));
    if (!p) return notFound(c);
    if (!p.jdText) return apiError(c, 422, "no_text", "A vaga não tem descrição para extrair.");
    const job = await enqueueExtraction(
      { repos, queue: deps.queue, dataDir: deps.dataDir, bus: deps.bus },
      p,
    );
    touched(p.id);
    return c.json({ job }, 202);
  });

  app.get("/api/postings/:id", (c) => {
    const posting = repos.postings.get(c.req.param("id"));
    if (!posting) return notFound(c);
    return c.json({
      posting,
      contacts: repos.postingContacts.list(posting.id),
      notes: repos.postingNotes.list(posting.id),
      duplicates: duplicatePostings(repos, posting).map((p) => p.id),
      // outras vagas da mesma empresa com o mesmo role (alerta da página, F06-11)
      related: relatedPostings(repos, posting),
    });
  });

  // histórico de análises, a mais recente primeiro, com a validade de cada uma (F06-10)
  app.get("/api/postings/:id/analyses", (c) => {
    const p = repos.postings.get(c.req.param("id"));
    if (!p) return notFound(c);
    return c.json({
      analyses: repos.jobAnalyses.list(p.id).map((a) => {
        const { usage: _usage, ...rest } = a;
        const parsed = JobAnalysisSchema.safeParse(a.analysis);
        return {
          ...rest,
          stale: analysisStale(repos, a, p),
          labels: parsed.success ? evidenceLabels(repos, parsed.data) : {},
        };
      }),
    });
  });

  app.patch("/api/postings/:id", validate("json", PostingPatchSchema), (c) => {
    const id = c.req.param("id");
    if (!repos.postings.get(id)) return notFound(c);
    const patch = c.req.valid("json");
    let posting = repos.postings.update(id, patch, { source: "user" });
    // JD editada pelo usuário: a heurística refaz a pré-análise na hora (sem tokens); a extração é sob pedido
    if (patch.jdText !== undefined && posting.jdText) {
      repos.postings.setPreAnalysis(
        id,
        buildPreAnalysis(repos, posting.jdText, posting).preAnalysis,
      );
      posting = repos.postings.get(id) ?? posting;
    }
    touched(id);
    return c.json({ posting });
  });

  app.delete("/api/postings/:id", (c) => {
    const id = c.req.param("id");
    if (!repos.postings.get(id)) return notFound(c);
    // F07: a vaga de uma candidatura é o que foi enviado; apagar a candidatura antes
    if (repos.jobApplications.countForPosting(id))
      return apiError(c, 409, "has_application", "Há uma candidatura nesta vaga");
    for (const n of repos.postingNotes.list(id))
      repos.notifications.resolveSubject("posting_note", n.id, ["posting.note_pending"]);
    // CVs e cartas da vaga (F05): as linhas caem em cascata; os arquivos e os avisos saem aqui
    for (const d of repos.documents.list({ postingId: id })) {
      repos.notifications.resolveSubject("document", d.id);
      if (deps.dataDir)
        rmSync(join(deps.dataDir, "documents", d.id), { recursive: true, force: true });
    }
    repos.postings.remove(id);
    touched(id);
    return c.body(null, 204);
  });

  /* contatos */
  app.post("/api/postings/:id/contacts", validate("json", PostingContactInputSchema), (c) => {
    const id = c.req.param("id");
    if (!repos.postings.get(id)) return notFound(c);
    const input = c.req.valid("json");
    const dup = repos.postingContacts.findDuplicate(id, input);
    if (dup) return duplicateContact(c, dup.name);
    const contact = repos.postingContacts.add(id, input);
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
      const patch = c.req.valid("json");
      const dup = repos.postingContacts.findDuplicate(
        cur.postingId,
        {
          name: patch.name ?? cur.name,
          email: patch.email === undefined ? cur.email : patch.email,
          linkedinUrl: patch.linkedinUrl === undefined ? cur.linkedinUrl : patch.linkedinUrl,
        },
        cur.id,
      );
      if (dup) return duplicateContact(c, dup.name);
      const contact = repos.postingContacts.update(cur.id, patch);
      touched(cur.postingId);
      return c.json({ contact });
    },
  );
  // fixado no topo da página (um por vaga: fixar outro solta o anterior)
  app.post(
    "/api/postings/:id/contacts/:contactId/pin",
    validate("json", z.object({ pinned: z.boolean() })),
    (c) => {
      const cur = repos.postingContacts.get(c.req.param("contactId"));
      if (!cur || cur.postingId !== c.req.param("id"))
        return apiError(c, 404, "contact_not_found", "Contato não encontrado");
      const contact = repos.postingContacts.setPinned(cur.id, c.req.valid("json").pinned);
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

/** Mesmo LinkedIn ou e-mail de um contato já registrado na vaga. */
function duplicateContact(c: Context, name: string) {
  return apiError(
    c,
    409,
    "duplicate_contact",
    `Esse contato já está na vaga (${name}), com o mesmo LinkedIn ou e-mail.`,
  );
}
