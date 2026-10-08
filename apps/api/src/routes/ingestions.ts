import {
  estimateExtraction,
  ProposalReviewError,
  type Repos,
  type ReviewDecision,
  resolveExtractionModels,
  trackInvalidation,
} from "@narnia-jobs/core";
import { IngestionCreateRequestSchema, ReviewRequestSchema } from "@narnia-jobs/shared";
import { Hono } from "hono";
import { apiError } from "../errors";
import type { EventBus } from "../events";
import type { QueueAdapter } from "../queue";
import { readMeta } from "../services/files";
import { toIngestionResponse } from "../services/ingestions";
import { patchOnboarding } from "./onboarding";
import { emitInvalidated } from "./profiles";
import { validate } from "./validate";

const DECISION: Record<"accepted" | "edited" | "rejected", ReviewDecision["decision"]> = {
  accepted: "accept",
  edited: "edit",
  rejected: "reject",
};

export function ingestionsRoutes(deps: {
  repos: Repos;
  dataDir: string;
  provider: { id: string };
  queue: QueueAdapter;
  bus: EventBus;
}) {
  const app = new Hono();

  app.post("/api/ingestions", validate("json", IngestionCreateRequestSchema), async (c) => {
    const body = c.req.valid("json");
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
    const fresh = deps.repos.ingestionRuns.get(run.id);
    if (!fresh) return apiError(c, 500, "internal", "Run não encontrado após criação");
    return c.json(toIngestionResponse(deps.repos, fresh), 201);
  });

  app.get("/api/ingestions/:id", (c) => {
    const run = deps.repos.ingestionRuns.get(c.req.param("id"));
    if (!run) return apiError(c, 404, "not_found", "Ingestão não encontrada");
    return c.json(toIngestionResponse(deps.repos, run));
  });

  app.post("/api/ingestions/:id/review", validate("json", ReviewRequestSchema), (c) => {
    const run = deps.repos.ingestionRuns.get(c.req.param("id"));
    if (!run) return apiError(c, 404, "not_found", "Ingestão não encontrada");
    const decisions: ReviewDecision[] = c.req.valid("json").decisions.map((d) => ({
      proposalId: d.proposalId,
      decision: DECISION[d.decision],
      ...(d.editedData ? { editedData: d.editedData } : {}),
    }));
    try {
      const { result, flipped } = trackInvalidation(deps.repos, () =>
        deps.repos.proposals.review(run.id, decisions),
      );
      emitInvalidated(deps.bus, flipped);
      const pending = deps.repos.proposals
        .listByRun(run.id)
        .filter((p) => p.decision === "pending");
      if (pending.length === 0) deps.repos.ingestionRuns.setStatus(run.id, "done");
      const runStatus = deps.repos.ingestionRuns.get(run.id)?.status ?? run.status;
      return c.json({ ...result, pending: pending.length, runStatus });
    } catch (e) {
      if (e instanceof ProposalReviewError) {
        const status =
          e.code === "foreign_proposal" ? 409 : e.code === "unknown_proposal" ? 404 : 400;
        return apiError(c, status, e.code, e.message);
      }
      throw e;
    }
  });

  return app;
}
