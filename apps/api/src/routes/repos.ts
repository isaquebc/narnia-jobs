import {
  ingestModelsForDepth,
  prepareTask,
  type Repos,
  resolveIngestSettings,
  splitBudget,
} from "@narnia-jobs/core";
import type { Provider } from "@narnia-jobs/providers";
import { ReanalyzeRequestSchema, RepoDigestPutRequestSchema } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { apiError } from "../errors";
import type { EventBus } from "../events";
import type { QueueAdapter } from "../queue";
import { emitRun, runSummary } from "../services/runs";
import { validate } from "./validate";

/** Evidências › Repositórios (F03 §4): repositórios, análises, digest editável, métricas e reanálise. */
export function reposRoutes(deps: {
  repos: Repos;
  provider: Provider;
  queue: QueueAdapter;
  bus: EventBus;
}) {
  const app = new Hono();

  app.get("/api/repos", (c) => c.json({ repos: deps.repos.repos.list() }));

  app.get("/api/repos/:id", (c) => {
    const repo = deps.repos.repos.get(c.req.param("id"));
    if (!repo) return apiError(c, 404, "not_found", "Repositório não encontrado");
    return c.json({
      repo,
      analyses: deps.repos.repoAnalyses.listByRepo(repo.id),
      digest: deps.repos.repoDigests.get(repo.id),
      metrics: deps.repos.githubMetrics.get({ scope: "repo", repoId: repo.id }),
    });
  });

  app.get("/api/repos/:id/digest", (c) => {
    const repo = deps.repos.repos.get(c.req.param("id"));
    if (!repo) return apiError(c, 404, "not_found", "Repositório não encontrado");
    return c.json({ digest: deps.repos.repoDigests.get(repo.id) });
  });

  app.put("/api/repos/:id/digest", validate("json", RepoDigestPutRequestSchema), (c) => {
    const repo = deps.repos.repos.get(c.req.param("id"));
    if (!repo) return apiError(c, 404, "not_found", "Repositório não encontrado");
    const digest = deps.repos.repoDigests.upsert({
      ...c.req.valid("json"),
      repoId: repo.id,
      editedByUser: true,
    });
    return c.json({ digest });
  });

  /**
   * Reanálise de um repositório (F03-3 §7): nova execução com ele só; commit novo vira incremental no worker,
   * mesmo commit vira segunda rodada (`deepen` padrão ou `cover`). Passa pela confirmação como qualquer execução.
   */
  app.post("/api/repos/:id/reanalyze", validate("json", ReanalyzeRequestSchema), async (c) => {
    const repo = deps.repos.repos.get(c.req.param("id"));
    if (!repo) return apiError(c, 404, "not_found", "Repositório não encontrado");
    const kind = c.req.valid("json").kind;
    const last = deps.repos.repoAnalyses.latestDone(repo.id);
    const depth = last?.depth ?? "balanced";
    const settings = resolveIngestSettings(deps.repos.settings);
    const models = ingestModelsForDepth(deps.repos.settings, depth);
    const budget = splitBudget({
      amount: settings.budgetDefaults[depth],
      unit: settings.budgetUnit,
      depth,
      repoCount: 1,
      reserve: { synthesis: 0, check: 0 },
    });
    const run = deps.repos.ingestionRuns.createGithub({
      provider: deps.provider.id,
      mode: repo.isPrivate ? "private" : "public",
      depth,
      model: models.repo,
      params: {
        repos: [repo.fullName],
        login: repo.owner,
        ...(kind && kind !== "incremental" ? { kind } : {}),
      },
      budget,
      parentRunId: last?.runId ?? null,
    });
    await deps.queue.enqueueTask(prepareTask(run.id));
    emitRun(deps.bus, deps.repos, run.id);
    const fresh = deps.repos.ingestionRuns.get(run.id);
    return c.json(fresh ? runSummary(fresh) : { id: run.id }, 201);
  });

  return app;
}
