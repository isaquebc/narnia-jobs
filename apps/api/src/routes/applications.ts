import type { Repos } from "@narnia-jobs/core";
import { ApplicationPatchSchema } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { apiError } from "../errors";
import type { EventBus } from "../events";
import type { QueueAdapter } from "../queue";
import { applicationView, enqueueLocate } from "../services/applications";
import { validate } from "./validate";

/**
 * Formulário de candidatura lido pela extensão (F12/M3, §4.8): a janela lê as perguntas e pode pedir para ler de novo
 * (depois de um erro, ou com o formulário mudado).
 */
export function applicationsRoutes(deps: {
  repos: Repos;
  queue?: QueueAdapter | undefined;
  bus?: EventBus | undefined;
}) {
  const app = new Hono();

  app.get("/api/applications/:id", (c) => {
    const f = deps.repos.applications.get(c.req.param("id"));
    if (!f) return apiError(c, 404, "not_found", "Formulário não encontrado");
    return c.json({ application: applicationView(deps.repos, f) });
  });

  // ligar o formulário à vaga certa quando a busca automática não achou (ou achou outra)
  app.patch("/api/applications/:id", validate("json", ApplicationPatchSchema), (c) => {
    const f = deps.repos.applications.get(c.req.param("id"));
    if (!f) return apiError(c, 404, "not_found", "Formulário não encontrado");
    const { postingId } = c.req.valid("json");
    if (postingId && !deps.repos.postings.get(postingId))
      return apiError(c, 404, "posting_not_found", "Vaga não encontrada");
    deps.repos.applications.setPosting(f.id, postingId);
    deps.bus?.emit({ type: "application.updated", applicationId: f.id });
    return c.json({
      application: applicationView(deps.repos, deps.repos.applications.get(f.id) as typeof f),
    });
  });

  app.post("/api/applications/:id/locate", async (c) => {
    const f = deps.repos.applications.get(c.req.param("id"));
    if (!f) return apiError(c, 404, "not_found", "Formulário não encontrado");
    if (!deps.queue) return apiError(c, 503, "queue_unavailable", "Fila indisponível");
    deps.repos.applications.setLocating(f.id);
    const job = await enqueueLocate(deps.queue, f.id);
    deps.bus?.emit({ type: "application.updated", applicationId: f.id });
    return c.json({ job }, 202);
  });

  return app;
}
