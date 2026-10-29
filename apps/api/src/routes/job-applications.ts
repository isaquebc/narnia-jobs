import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import {
  addJobApplicationEntry,
  addJobApplicationEvent,
  applyOptions,
  applyToPosting,
  attachmentPath,
  type EntryFile,
  JobApplicationError,
  jobApplicationFunnel,
  listJobApplications,
  listSavedPostings,
  type Repos,
  rejectJobApplication,
  removeJobApplication,
  removeJobApplicationEntry,
  removeJobApplicationEvent,
  setCurrentStage,
  setJobApplicationStages,
  summarize,
  upcomingJobApplicationEvents,
  updateJobApplicationEntry,
  updateJobApplicationEvent,
} from "@narnia-jobs/core";
import {
  ATTACHMENT_MAX_BYTES,
  buildIcs,
  CalendarDateSchema,
  JobApplicationCreateSchema,
  JobApplicationEntryPatchSchema,
  JobApplicationEventInputSchema,
  JobApplicationEventPatchSchema,
  JobApplicationPatchSchema,
  JobApplicationRejectSchema,
  JobApplicationStagesPutSchema,
} from "@narnia-jobs/shared";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { apiError } from "../errors";
import type { EventBus } from "../events";
import { validate } from "./validate";

const ERROR_STATUS: Record<JobApplicationError["code"], ContentfulStatusCode> = {
  posting_not_found: 404,
  cv_required: 400,
  version_not_ready: 400,
  wrong_posting: 400,
  future_date: 400,
  duplicate_pending: 409,
  already_applied: 409,
  stage_not_found: 400,
  not_found: 404,
  entry_empty: 400,
  file_too_large: 413,
  invalid_datetime: 400,
  already_closed: 409,
};

/**
 * Tipos que abrem no navegador (prévia de imagem, PDF, vídeo e áudio); o resto baixa como binário, para um HTML ou SVG
 * anexado nunca rodar na origem da aplicação.
 */
const INLINE =
  /^(image\/(png|jpeg|gif|webp|avif)|application\/pdf|video\/(mp4|webm|ogg|quicktime)|audio\/[\w.+-]+|text\/plain)$/;

/** `bytes=a-b` → intervalo dentro do arquivo; null se ausente ou inválido (serve o arquivo inteiro). */
function rangeOf(header: string | undefined, size: number): { start: number; end: number } | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header) : null;
  if (!m || (!m[1] && !m[2])) return null;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : null;
}

/** Arquiva as candidaturas sem atividade há 40 dias (F07 §0-6); no boot e uma vez por dia. Devolve quantas. */
export function archiveJobApplicationsNow(
  deps: { repos: Repos; bus?: EventBus | undefined },
  now = new Date(),
): number {
  const ids = deps.repos.jobApplications.archiveInactive(now);
  for (const id of ids) deps.bus?.emit({ type: "job_application.updated", applicationId: id });
  return ids.length;
}

/**
 * Candidaturas (F07 §0, requisitos do dono 2026-10-27): só o "Aplicar" cria (com o CV obrigatório e as versões
 * travadas); o quadro move as colunas; arquivar e desarquivar; lista com busca por empresa, cliente, cargo, data e
 * contato.
 */
export function jobApplicationsRoutes(deps: {
  repos: Repos;
  dataDir: string;
  bus?: EventBus | undefined;
  /** Endereço da interface para o link da candidatura no `.ics` (a web manda o dela em `?origin=`). */
  publicUrl?: string | undefined;
}) {
  const app = new Hono();
  const { repos } = deps;
  const changed = (applicationId: string, postingId: string) => {
    deps.bus?.emit({ type: "job_application.updated", applicationId });
    deps.bus?.emit({ type: "posting.updated", postingId });
  };

  app.get("/api/postings/:id/apply-options", (c) => {
    const postingId = c.req.param("id");
    if (!repos.postings.get(postingId)) return apiError(c, 404, "not_found", "Vaga não encontrada");
    return c.json(applyOptions(repos, postingId));
  });

  app.get("/api/job-applications", (c) => {
    const archived = c.req.query("archived") === "1";
    const q = c.req.query("q");
    return c.json({
      applications: listJobApplications(repos, { q, archived }),
      // coluna "Vagas salvas" (antes de Aplicado): vagas sem candidatura
      saved: listSavedPostings(repos, { q, archived }),
    });
  });

  app.post("/api/job-applications", validate("json", JobApplicationCreateSchema), (c) => {
    try {
      const created = applyToPosting(repos, c.req.valid("json"));
      changed(created.id, created.postingId);
      return c.json({ application: summarize(repos, created) }, 201);
    } catch (e) {
      if (!(e instanceof JobApplicationError)) throw e;
      return apiError(
        c,
        ERROR_STATUS[e.code],
        e.code,
        e.message,
        e.applicationId ? { applicationId: e.applicationId } : undefined,
      );
    }
  });

  // F07/M5: lembretes (próximas horas e atrasados) e funil; antes de `/:id`
  app.get("/api/job-applications/upcoming", (c) => {
    const hours = Math.min(Math.max(Number(c.req.query("hours") ?? 24) || 24, 1), 24 * 14);
    return c.json(upcomingJobApplicationEvents(repos, { hours }));
  });
  app.get("/api/job-applications/funnel", (c) => c.json(jobApplicationFunnel(repos)));

  app.get("/api/job-applications/:id", (c) => {
    const found = repos.jobApplications.get(c.req.param("id"));
    if (!found) return apiError(c, 404, "not_found", "Candidatura não encontrada");
    return c.json({ application: summarize(repos, found) });
  });

  app.patch("/api/job-applications/:id", validate("json", JobApplicationPatchSchema), (c) => {
    const id = c.req.param("id");
    if (!repos.jobApplications.get(id))
      return apiError(c, 404, "not_found", "Candidatura não encontrada");
    const { currentStageId, ...patch } = c.req.valid("json");
    try {
      if (currentStageId !== undefined) setCurrentStage(repos, id, currentStageId);
    } catch (e) {
      if (!(e instanceof JobApplicationError)) throw e;
      return apiError(c, ERROR_STATUS[e.code], e.code, e.message);
    }
    const updated =
      Object.keys(patch).length > 0 || currentStageId === undefined
        ? repos.jobApplications.update(id, patch)
        : (repos.jobApplications.get(id) as NonNullable<
            ReturnType<typeof repos.jobApplications.get>
          >);
    changed(id, updated.postingId);
    return c.json({ application: summarize(repos, updated) });
  });

  // desclassificação (2026-10-29): o e-mail colado vira nota e a candidatura vai para Encerrado com a etapa
  app.post(
    "/api/job-applications/:id/reject",
    validate("json", JobApplicationRejectSchema),
    (c) => {
      const id = c.req.param("id");
      try {
        const updated = rejectJobApplication(repos, deps.dataDir, id, c.req.valid("json"));
        changed(id, updated.postingId);
        return c.json({ application: summarize(repos, updated) });
      } catch (e) {
        if (!(e instanceof JobApplicationError)) throw e;
        return apiError(c, ERROR_STATUS[e.code], e.code, e.message);
      }
    },
  );

  // F07/M2: o pipeline editado (adicionar, remover, reordenar)
  app.put(
    "/api/job-applications/:id/stages",
    validate("json", JobApplicationStagesPutSchema),
    (c) => {
      const id = c.req.param("id");
      if (!repos.jobApplications.get(id))
        return apiError(c, 404, "not_found", "Candidatura não encontrada");
      try {
        const updated = setJobApplicationStages(repos, id, c.req.valid("json").stages);
        changed(id, updated.postingId);
        return c.json({ application: summarize(repos, updated) });
      } catch (e) {
        if (!(e instanceof JobApplicationError)) throw e;
        return apiError(c, ERROR_STATUS[e.code], e.code, e.message);
      }
    },
  );

  app.delete("/api/job-applications/:id", (c) => {
    const found = repos.jobApplications.get(c.req.param("id"));
    if (!found) return apiError(c, 404, "not_found", "Candidatura não encontrada");
    removeJobApplication(repos, deps.dataDir, found.id);
    changed(found.id, found.postingId);
    return c.body(null, 204);
  });

  // F07/M3: notas e anexos datados
  const fail = (c: Parameters<typeof apiError>[0], e: unknown) => {
    if (!(e instanceof JobApplicationError)) throw e;
    return apiError(c, ERROR_STATUS[e.code], e.code, e.message);
  };

  app.get("/api/job-applications/:id/entries", (c) => {
    const id = c.req.param("id");
    if (!repos.jobApplications.get(id))
      return apiError(c, 404, "not_found", "Candidatura não encontrada");
    return c.json({ entries: repos.jobApplicationEntries.list(id) });
  });

  app.post("/api/job-applications/:id/entries", async (c) => {
    const id = c.req.param("id");
    const form = await c.req.parseBody({ all: true });
    const date = CalendarDateSchema.safeParse(form.occurredOn);
    if (!date.success) return apiError(c, 400, "invalid_date", "Data inválida (YYYY-MM-DD)");
    const raw = form.files;
    const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(
      (f): f is File => f instanceof File,
    );
    if (list.some((f) => f.size > ATTACHMENT_MAX_BYTES))
      return apiError(c, 413, "file_too_large", "Arquivo acima de 100 MB: guarde o link na nota");
    const files: EntryFile[] = await Promise.all(
      list.map(async (f) => ({
        name: f.name,
        type: f.type,
        bytes: new Uint8Array(await f.arrayBuffer()),
      })),
    );
    try {
      const entry = addJobApplicationEntry(repos, deps.dataDir, id, {
        occurredOn: date.data,
        body: typeof form.body === "string" ? form.body : null,
        files,
      });
      deps.bus?.emit({ type: "job_application.updated", applicationId: id });
      return c.json({ entry }, 201);
    } catch (e) {
      return fail(c, e);
    }
  });

  app.patch(
    "/api/job-applications/:id/entries/:eid",
    validate("json", JobApplicationEntryPatchSchema),
    (c) => {
      const id = c.req.param("id");
      try {
        const entry = updateJobApplicationEntry(repos, id, c.req.param("eid"), c.req.valid("json"));
        deps.bus?.emit({ type: "job_application.updated", applicationId: id });
        return c.json({ entry });
      } catch (e) {
        return fail(c, e);
      }
    },
  );

  app.delete("/api/job-applications/:id/entries/:eid", (c) => {
    const id = c.req.param("id");
    try {
      removeJobApplicationEntry(repos, deps.dataDir, id, c.req.param("eid"));
      deps.bus?.emit({ type: "job_application.updated", applicationId: id });
      return c.body(null, 204);
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get("/api/job-applications/:id/attachments/:aid", (c) => {
    const a = repos.jobApplicationEntries.attachment(c.req.param("aid"));
    const path = a ? attachmentPath(deps.dataDir, a.id) : null;
    if (!a || a.applicationId !== c.req.param("id") || !path || !existsSync(path))
      return apiError(c, 404, "not_found", "Anexo não encontrado");
    const inline = INLINE.test(a.mime);
    const size = statSync(path).size;
    const range = rangeOf(c.req.header("range"), size);
    const headers: Record<string, string> = {
      "content-type": inline ? a.mime : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    };
    const stream = (start: number, end: number) =>
      Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    if (range) {
      headers["content-range"] = `bytes ${range.start}-${range.end}/${size}`;
      headers["content-length"] = String(range.end - range.start + 1);
      return c.body(stream(range.start, range.end), 206, headers);
    }
    headers["content-length"] = String(size);
    return c.body(stream(0, Math.max(0, size - 1)), 200, headers);
  });

  // F07/M5: agenda da candidatura
  const touched = (id: string) =>
    deps.bus?.emit({ type: "job_application.updated", applicationId: id });

  app.get("/api/job-applications/:id/events", (c) => {
    const id = c.req.param("id");
    if (!repos.jobApplications.get(id))
      return apiError(c, 404, "not_found", "Candidatura não encontrada");
    return c.json({ events: repos.jobApplicationEvents.list(id) });
  });

  app.post(
    "/api/job-applications/:id/events",
    validate("json", JobApplicationEventInputSchema),
    (c) => {
      const id = c.req.param("id");
      try {
        const event = addJobApplicationEvent(repos, id, c.req.valid("json"));
        touched(id);
        return c.json({ event }, 201);
      } catch (e) {
        return fail(c, e);
      }
    },
  );

  app.patch(
    "/api/job-applications/:id/events/:eid",
    validate("json", JobApplicationEventPatchSchema),
    (c) => {
      const id = c.req.param("id");
      try {
        const event = updateJobApplicationEvent(repos, id, c.req.param("eid"), c.req.valid("json"));
        touched(id);
        return c.json({ event });
      } catch (e) {
        return fail(c, e);
      }
    },
  );

  app.delete("/api/job-applications/:id/events/:eid", (c) => {
    const id = c.req.param("id");
    try {
      removeJobApplicationEvent(repos, id, c.req.param("eid"));
      touched(id);
      return c.body(null, 204);
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get("/api/job-applications/:id/events/:eid/calendar.ics", (c) => {
    const id = c.req.param("id");
    const ev = repos.jobApplicationEvents.get(c.req.param("eid"));
    if (!ev || ev.applicationId !== id)
      return apiError(c, 404, "not_found", "Evento não encontrado");
    const origin = c.req.query("origin");
    const base = origin && /^https?:\/\/[^/]+$/i.test(origin) ? origin : (deps.publicUrl ?? "");
    const ics = buildIcs({
      id: ev.id,
      title: ev.title,
      startsAt: ev.startsAt,
      durationMin: ev.durationMin,
      location: ev.location,
      link: ev.link,
      notes: ev.notes,
      sequence: ev.icsSequence,
      appUrl: `${base.replace(/\/$/, "")}/candidaturas/${id}`,
    });
    return c.body(ics, 200, {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="narnia-${ev.id}.ics"`,
    });
  });

  return app;
}
