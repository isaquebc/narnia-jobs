import type { Repos } from "@narnia-jobs/core";
import { nowUtc } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { apiError } from "../errors";
import type { QueueAdapter } from "../queue";

const TERMINAL = new Set(["done", "error", "cancelled"]);

/** Bandeja de atividades: lista, cancela e tenta de novo (F01 §2.6). */
export function jobsRoutes(deps: { repos: Repos; queue: QueueAdapter }) {
  const app = new Hono();

  app.get("/api/jobs", (c) => {
    const limit = Number(c.req.query("limit") ?? 100);
    return c.json({ jobs: deps.repos.jobs.list({ limit: Number.isFinite(limit) ? limit : 100 }) });
  });

  app.get("/api/jobs/:id", (c) => {
    const job = deps.repos.jobs.get(c.req.param("id"));
    return job ? c.json(job) : apiError(c, 404, "not_found", "Job não encontrado");
  });

  app.post("/api/jobs/:id/cancel", async (c) => {
    const job = deps.repos.jobs.get(c.req.param("id"));
    if (!job) return apiError(c, 404, "not_found", "Job não encontrado");
    if (TERMINAL.has(job.status))
      return apiError(c, 409, "job_terminal", "Job já concluído, cancelado ou com erro");
    const result = await deps.queue.cancel(job.id);
    if (result === "active")
      return apiError(c, 409, "job_active", "Job em execução não pode ser cancelado agora");
    const at = nowUtc();
    deps.repos.jobs.applyEvent({ jobId: job.id, type: "cancelled", at });
    if (job.parentId) {
      deps.repos.ingestionRuns.setStatus(job.parentId, "error", {
        error: "Cancelado pelo usuário",
      });
    }
    return c.json(deps.repos.jobs.get(job.id));
  });

  app.post("/api/jobs/:id/retry", async (c) => {
    const job = deps.repos.jobs.get(c.req.param("id"));
    if (!job) return apiError(c, 404, "not_found", "Job não encontrado");
    if (job.status !== "error" && job.status !== "cancelled") {
      return apiError(
        c,
        409,
        "job_not_failed",
        "Só jobs com erro ou cancelados podem ser repetidos",
      );
    }
    const at = nowUtc();
    deps.repos.jobs.requeue(job.id, at);
    const ok = await deps.queue.retry(job.id);
    if (!ok) return apiError(c, 500, "retry_failed", "Não foi possível reenfileirar o job");
    if (job.parentId) deps.repos.ingestionRuns.setStatus(job.parentId, "running");
    return c.json(deps.repos.jobs.get(job.id));
  });

  return app;
}
