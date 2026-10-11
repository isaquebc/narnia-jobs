import {
  cancelRun,
  confirmRun,
  decideRun,
  estimateExtraction,
  estimateRun,
  type IngestionRunRecord,
  ingestModelsForDepth,
  markRunOpened,
  prepareTask,
  type Repos,
  type ReviewDecision,
  recommendBudget,
  resolveExtractionModels,
  resolveIngestSettings,
  splitBudget,
  type TaskRequest,
  trackInvalidation,
} from "@narnia-jobs/core";
import type { Provider } from "@narnia-jobs/providers";
import {
  type EmphasisFactKind,
  type GithubIngestionCreateRequest,
  GithubIngestionCreateRequestSchema,
  IngestionCreateRequestSchema,
  IngestionDecisionRequestSchema,
  IngestionEstimateRequestSchema,
  IngestionSourceSchema,
  ReviewRequestSchema,
  RunStatusSchema,
} from "@narnia-jobs/shared";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { apiError, ingestErrorResponse } from "../errors";
import type { EventBus } from "../events";
import type { QueueAdapter } from "../queue";
import { readMeta } from "../services/files";
import { toIngestionResponse, toProposalDto } from "../services/ingestions";
import { emitRun, enqueueAll, runSummary } from "../services/runs";
import { patchOnboarding } from "./onboarding";
import { emitInvalidated } from "./profiles";
import { validate } from "./validate";

const DECISION: Record<"accepted" | "edited" | "rejected", ReviewDecision["decision"]> = {
  accepted: "accept",
  edited: "edit",
  rejected: "reject",
};

/** Tipos de fato que aceitam ênfase por perfil (tags da revisão, F03 §2.8). */
const TAGGABLE = new Set<string>([
  "experience",
  "project",
  "skill",
  "education",
  "language",
  "achievement",
]);
/** Tamanho típico da tabela de métricas antes da coleta (estimativa sem chamar o GitHub). */
const TYPICAL_METRICS_CHARS = 1_500;

const ListQuerySchema = z.object({
  status: z.string().optional(),
  source: IngestionSourceSchema.optional(),
});

function validationError(c: Context, issues: z.core.$ZodIssue[]) {
  return c.json(
    {
      error: {
        code: "validation",
        message: "Dados inválidos",
        details: issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    },
    400,
  );
}

/** Orçamento da execução do GitHub: pedido pelo usuário ou o recomendado, dividido igualmente (F03-3 §1–2). */
async function githubPlan(repos: Repos, provider: Provider, body: GithubIngestionCreateRequest) {
  const settings = resolveIngestSettings(repos.settings);
  const models = ingestModelsForDepth(repos.settings, body.depth, body.model);
  const est = estimateRun({
    depth: body.depth,
    models,
    checkEnabled: settings.reviewCheckModelEnabled,
    metricsChars: TYPICAL_METRICS_CHARS,
    repos: body.repos.map((fullName) => ({ fullName })),
  });
  const planUsage = await provider.getPlanUsage().catch(() => null);
  const rec = recommendBudget({
    depth: body.depth,
    defaults: settings.budgetDefaults,
    planUsage,
    pctToTokens: settings.pctToTokens,
    model: models.repo,
  });
  const budget = splitBudget({
    amount: body.budget?.amount ?? rec.amount,
    unit: body.budget?.unit ?? settings.budgetUnit,
    depth: body.depth,
    repoCount: body.repos.length,
    reserve: { synthesis: est.synthesisTokens, check: est.checkTokens },
  });
  return { est, rec, budget };
}

export function ingestionsRoutes(deps: {
  repos: Repos;
  dataDir: string;
  provider: Provider;
  queue: QueueAdapter;
  bus: EventBus;
}) {
  const app = new Hono();
  const find = (id: string): IngestionRunRecord | null => deps.repos.ingestionRuns.get(id);

  // estimativa antes de rodar (F03 §2.4): GitHub com orçamento recomendado; CV/texto com autoconfirmação
  app.post(
    "/api/ingestions/estimate",
    validate("json", IngestionEstimateRequestSchema),
    async (c) => {
      const body = c.req.valid("json");
      if ("repos" in body) {
        const { est, rec, budget } = await githubPlan(deps.repos, deps.provider, body);
        return c.json({
          calls: est.calls.map((x) => ({ name: x.name, model: x.model, tokens: x.tokens })),
          totalTokens: est.totalTokens,
          recommendedBudget: rec.amount,
          perRepo: budget.perRepo,
          approximate: rec.approximate,
          autoConfirm: false,
        });
      }
      const file = deps.repos.sourceFiles.get(body.fileId);
      if (!file) return apiError(c, 404, "not_found", "Arquivo não encontrado");
      const meta = readMeta(deps.dataDir, file);
      const pdf = file.mime === "application/pdf";
      const models = resolveExtractionModels(deps.repos.settings);
      const est = estimateExtraction({
        textChars: meta?.chars ?? 0,
        ...(meta?.pages ? { pdfPages: meta.pages } : {}),
        models: body.model ? { ...models, facts: body.model } : models,
        options: { ocr: pdf, modelRead: pdf },
      });
      const calls = [
        ...(est.calls.document ? [{ name: "readDocument", ...est.calls.document }] : []),
        { name: "extractFacts", ...est.calls.facts },
        { name: "buildDigest", ...est.calls.digest },
      ];
      const threshold = resolveIngestSettings(deps.repos.settings).autoConfirmBelow;
      return c.json({
        calls: calls.map((x) => ({ name: x.name, model: x.model, tokens: x.tokens })),
        totalTokens: est.totalTokens,
        recommendedBudget: est.totalTokens,
        perRepo: null,
        approximate: false,
        autoConfirm: threshold > 0 && est.totalTokens < threshold,
      });
    },
  );

  app.post("/api/ingestions", async (c) => {
    const raw = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (raw?.source === "github") {
      const parsed = GithubIngestionCreateRequestSchema.safeParse(raw);
      if (!parsed.success) return validationError(c, parsed.error.issues);
      const body = parsed.data;
      const { budget } = await githubPlan(deps.repos, deps.provider, body);
      const run = deps.repos.ingestionRuns.createGithub({
        provider: deps.provider.id,
        mode: body.mode,
        depth: body.depth,
        model: body.model,
        params: { repos: body.repos, ...(body.login ? { login: body.login } : {}) },
        budget,
      });
      await deps.queue.enqueueTask(prepareTask(run.id));
      emitRun(deps.bus, deps.repos, run.id);
      return c.json(runSummary(find(run.id) as IngestionRunRecord), 201);
    }
    const parsed = IngestionCreateRequestSchema.safeParse(raw ?? {});
    if (!parsed.success) return validationError(c, parsed.error.issues);
    const body = parsed.data;
    const file = deps.repos.sourceFiles.get(body.fileId);
    if (!file) return apiError(c, 404, "not_found", "Arquivo não encontrado");
    const meta = readMeta(deps.dataDir, file);
    const models = resolveExtractionModels(deps.repos.settings);
    const options = {
      ocr: file.mime === "application/pdf" && body.options.ocr,
      modelRead: file.mime === "application/pdf" && body.options.modelRead,
    };
    const run = deps.repos.ingestionRuns.create({
      fileId: file.id,
      provider: deps.provider.id,
      models,
      options,
    });
    const est = estimateExtraction({
      textChars: meta?.chars ?? 0,
      ...(meta?.pages ? { pdfPages: meta.pages } : {}),
      models,
      options,
    });
    deps.repos.ingestionRuns.setEstimate(run.id, {
      documentTokens: est.calls.document?.tokens ?? 0,
      factsTokens: est.calls.facts.tokens,
      digestTokens: est.calls.digest.tokens,
    });
    deps.repos.ingestionRuns.setStatus(run.id, "queued");
    await deps.queue.enqueue(run.id, "ingest.read_text");
    patchOnboarding(deps.repos, { runId: run.id, fileId: file.id });
    const fresh = find(run.id);
    if (!fresh) return apiError(c, 500, "internal", "Run não encontrado após criação");
    return c.json(toIngestionResponse(deps.repos, fresh), 201);
  });

  app.get("/api/ingestions", validate("query", ListQuerySchema), (c) => {
    const q = c.req.valid("query");
    const statuses = q.status
      ?.split(",")
      .map((s) => RunStatusSchema.safeParse(s.trim()))
      .filter((r) => r.success)
      .map((r) => r.data);
    const runs = deps.repos.ingestionRuns.list({
      ...(statuses?.length ? { status: statuses } : {}),
      ...(q.source ? { source: q.source } : {}),
    });
    return c.json({ runs: runs.map(runSummary) });
  });

  app.get("/api/ingestions/:id", (c) => {
    const found = find(c.req.param("id"));
    if (!found) return apiError(c, 404, "not_found", "Ingestão não encontrada");
    // execução presa (tarefa falhou de vez antes da correção de 2026-10-11): vira erro com a tarefa guardada
    if (healStuckRun(deps.repos, found.id)) emitRun(deps.bus, deps.repos, found.id);
    const run = find(found.id) ?? found;
    // FX-3: abrir a execução resolve a notificação informativa "ingestão concluída"
    for (const ev of markRunOpened(deps.repos, run.id))
      deps.bus.emit({ type: "notification.updated", notification: ev.notification });
    return c.json(toIngestionResponse(deps.repos, run));
  });

  app.post("/api/ingestions/:id/confirm", async (c) => {
    try {
      const tasks = confirmRun(deps.repos, c.req.param("id"));
      await enqueueAll(deps.queue, tasks);
      emitRun(deps.bus, deps.repos, c.req.param("id"));
      return c.json({ status: find(c.req.param("id"))?.status, enqueued: tasks.length });
    } catch (e) {
      return ingestErrorResponse(c, e);
    }
  });

  app.post(
    "/api/ingestions/:id/decision",
    validate("json", IngestionDecisionRequestSchema),
    async (c) => {
      try {
        const r = decideRun(deps.repos, c.req.param("id"), c.req.valid("json"));
        await enqueueAll(deps.queue, r.tasks);
        emitRun(deps.bus, deps.repos, c.req.param("id"));
        return c.json({ status: r.status, enqueued: r.tasks.length });
      } catch (e) {
        return ingestErrorResponse(c, e);
      }
    },
  );

  app.post("/api/ingestions/:id/cancel", (c) => {
    try {
      cancelRun(deps.repos, c.req.param("id"));
      emitRun(deps.bus, deps.repos, c.req.param("id"));
      return c.json({ status: "cancelled" });
    } catch (e) {
      return ingestErrorResponse(c, e);
    }
  });

  // GitHub com erro (coleta, login, rate limit) volta a preparar; CV/texto usam `POST /api/jobs/:id/retry`
  app.post("/api/ingestions/:id/retry", async (c) => {
    const run = find(c.req.param("id"));
    if (!run) return apiError(c, 404, "run_not_found", "Ingestão não encontrada");
    if (run.source !== "github" || run.status !== "error") {
      return apiError(c, 409, "invalid_state", "Só execuções do GitHub com erro voltam a preparar");
    }
    // tarefa que falhou de vez (síntese, repositório, conferência…): refaz só ela, sem repetir o que já terminou
    const failed = run.params.failedTask as TaskRequest | undefined;
    if (failed?.type) {
      const { failedTask: _done, ...params } = run.params;
      deps.repos.ingestionRuns.setParams(run.id, params);
      deps.repos.ingestionRuns.setStatus(run.id, "running", { error: null });
      await deps.queue.enqueueTask(failed);
      emitRun(deps.bus, deps.repos, run.id);
      return c.json({ status: "running" });
    }
    deps.repos.ingestionRuns.setStatus(run.id, "estimating", { error: null });
    await deps.queue.enqueueTask(prepareTask(run.id));
    emitRun(deps.bus, deps.repos, run.id);
    return c.json({ status: "estimating" });
  });

  app.get("/api/ingestions/:id/proposals", (c) => {
    const run = find(c.req.param("id"));
    if (!run) return apiError(c, 404, "not_found", "Ingestão não encontrada");
    const segments = deps.repos.readings.segmentsByRun(run.id);
    return c.json({
      proposals: deps.repos.proposals.listByRun(run.id).map((p) => toProposalDto(p, segments)),
    });
  });

  app.post("/api/ingestions/:id/review", validate("json", ReviewRequestSchema), (c) => {
    const run = find(c.req.param("id"));
    if (!run) return apiError(c, 404, "not_found", "Ingestão não encontrada");
    const body = c.req.valid("json");
    const decisions: ReviewDecision[] = body.decisions.map((d) => ({
      proposalId: d.proposalId,
      decision: DECISION[d.decision],
      ...(d.editedData ? { editedData: d.editedData } : {}),
      ...(d.resolution ? { resolution: d.resolution } : {}),
    }));
    try {
      const { result, flipped } = trackInvalidation(deps.repos, () => {
        const r = deps.repos.proposals.review(run.id, decisions);
        // tags por perfil: o fato aceito entra destacado só nos perfis marcados (F03 §2.8)
        const byId = new Map(deps.repos.proposals.listByRun(run.id).map((p) => [p.id, p]));
        for (const d of body.decisions) {
          const p = byId.get(d.proposalId);
          if (!d.profiles?.length || !p?.targetId || !TAGGABLE.has(p.kind)) continue;
          const kind = p.kind as EmphasisFactKind;
          for (const profileId of d.profiles) {
            const keep = deps.repos.emphasis
              .list(profileId)
              .filter((e) => e.factKind === kind && e.factId !== p.targetId)
              .map((e) => ({
                kind,
                id: e.factId,
                mode: e.mode,
                position: e.position ?? undefined,
              }));
            deps.repos.emphasis.replace(
              profileId,
              [...keep, { kind, id: p.targetId, mode: "highlight" }],
              { kinds: [kind] },
            );
          }
        }
        return r;
      });
      emitInvalidated(deps.bus, flipped);
      const pending = deps.repos.proposals
        .listByRun(run.id)
        .filter((p) => p.decision === "pending");
      if (pending.length === 0) deps.repos.ingestionRuns.setStatus(run.id, "done");
      emitRun(deps.bus, deps.repos, run.id);
      const runStatus = find(run.id)?.status ?? run.status;
      return c.json({ ...result, pending: pending.length, runStatus });
    } catch (e) {
      return ingestErrorResponse(c, e);
    }
  });

  return app;
}

const IN_PROGRESS = new Set(["queued", "estimating", "running"]);
const LIVE_JOB = new Set(["queued", "active", "stalled"]);

/**
 * Execução "em andamento" sem nenhum job vivo e com tarefa em erro está presa: marca como erro e guarda a tarefa
 * que falhou em `params.failedTask`, para o "Tentar de novo" refazer só ela. Devolve true se mudou algo.
 */
export function healStuckRun(repos: Repos, runId: string): boolean {
  const run = repos.ingestionRuns.get(runId);
  if (!run || !IN_PROGRESS.has(run.status)) return false;
  const jobs = repos.jobs
    .list({ limit: 1000 })
    .filter((j) => j.type.startsWith("ingest.") && j.payload.runId === runId);
  if (jobs.length === 0 || jobs.some((j) => LIVE_JOB.has(j.status))) return false;
  const failed = jobs.find((j) => j.status === "error");
  if (!failed) return false;
  const prefix = `task__${failed.type}__`;
  repos.ingestionRuns.setParams(runId, {
    ...run.params,
    failedTask: {
      queue: failed.queue,
      type: failed.type,
      key: failed.id.startsWith(prefix) ? failed.id.slice(prefix.length) : runId,
      payload: failed.payload,
    },
  });
  repos.ingestionRuns.setStatus(runId, "error", { error: failed.error ?? "Tarefa falhou" });
  return true;
}
