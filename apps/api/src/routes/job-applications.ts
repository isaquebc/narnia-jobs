import {
  applyOptions,
  applyToPosting,
  JobApplicationError,
  listJobApplications,
  listSavedPostings,
  type Repos,
  summarize,
} from "@narnia-jobs/core";
import { JobApplicationCreateSchema, JobApplicationPatchSchema } from "@narnia-jobs/shared";
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
};

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
export function jobApplicationsRoutes(deps: { repos: Repos; bus?: EventBus | undefined }) {
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

  app.get("/api/job-applications/:id", (c) => {
    const found = repos.jobApplications.get(c.req.param("id"));
    if (!found) return apiError(c, 404, "not_found", "Candidatura não encontrada");
    return c.json({ application: summarize(repos, found) });
  });

  app.patch("/api/job-applications/:id", validate("json", JobApplicationPatchSchema), (c) => {
    const id = c.req.param("id");
    if (!repos.jobApplications.get(id))
      return apiError(c, 404, "not_found", "Candidatura não encontrada");
    const updated = repos.jobApplications.update(id, c.req.valid("json"));
    changed(id, updated.postingId);
    return c.json({ application: summarize(repos, updated) });
  });

  app.delete("/api/job-applications/:id", (c) => {
    const found = repos.jobApplications.get(c.req.param("id"));
    if (!found) return apiError(c, 404, "not_found", "Candidatura não encontrada");
    repos.jobApplications.remove(found.id);
    changed(found.id, found.postingId);
    return c.body(null, 204);
  });

  return app;
}
