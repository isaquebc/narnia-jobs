import {
  friendlyError,
  type IngestionRunRecord,
  type ProposalRecord,
  type Repos,
  runJobs,
  type SegmentRecord,
  STAGES,
} from "@narnia-jobs/core";
import type { FactProposal } from "@narnia-jobs/shared";
import { runTimeline } from "./runs";

type Origin = "text_layer" | "ocr" | "model_read" | "consolidated";

function candidates(p: FactProposal): string[] {
  switch (p.kind) {
    case "experience":
      return [p.data.company, p.data.title];
    case "education":
      return [p.data.institution, p.data.course];
    case "skill":
    case "language":
      return [p.data.name];
    case "identity":
      return [p.data.fullName, p.data.email].filter((s): s is string => Boolean(s));
    case "link":
      return [p.data.url];
    case "achievement":
      return [p.data.text.slice(0, 40)];
    default:
      return [];
  }
}

/** Origem por trecho (F01 §4): de qual leitura veio o segmento que contém o fato; "consolidated" se não há trecho claro. */
export function inferOrigin(p: FactProposal, segments: SegmentRecord[]): Origin | null {
  if (segments.length === 0) return null;
  for (const raw of candidates(p)) {
    const needle = raw.trim().toLowerCase();
    if (needle.length < 3) continue;
    for (const s of segments) {
      const hay = s.text.toLowerCase();
      const hit =
        needle.length < 5
          ? new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(s.text)
          : hay.includes(needle);
      if (hit) return s.origin;
    }
  }
  return "consolidated";
}

/** Proposta para a revisão (F03 §2.9-6): reconciliação, evidência literal, selo e perfis sugeridos. */
export function toProposalDto(p: ProposalRecord, segments: SegmentRecord[]) {
  return {
    id: p.id,
    proposal: p.proposal,
    decision: p.decision === "skipped" ? ("rejected" as const) : p.decision,
    origin: inferOrigin(p.proposal, segments),
    editedData: p.editedData,
    match: p.match,
    matchTargetId: p.matchTargetId,
    conflict: p.conflict,
    resolution: p.resolution,
    evidence: p.evidence,
    checkStatus: p.checkStatus,
    suggestedProfiles: p.suggestedProfiles,
  };
}

export function toIngestionResponse(repos: Repos, run: IngestionRunRecord) {
  const segments = repos.readings.segmentsByRun(run.id);
  // etapas (parentId) e tarefas do GitHub (runId dentro da tarefa): antes a página do GitHub vinha sem jobs (C1)
  const jobs = runJobs(repos, run.id).sort(
    (a, b) =>
      (STAGES[a.type as keyof typeof STAGES]?.order ?? 99) -
      (STAGES[b.type as keyof typeof STAGES]?.order ?? 99),
  );
  const proposals = repos.proposals.listByRun(run.id).map((p) => toProposalDto(p, segments));
  const digest = run.fileId ? repos.digests.get(run.fileId) : null;
  return {
    id: run.id,
    fileId: run.fileId,
    source: run.source,
    mode: run.mode,
    model: run.model,
    depth: run.depth,
    budget: run.budget,
    report: run.report,
    repos: run.params.repos ?? [],
    analyses: repos.repoAnalyses.listByRun(run.id),
    parentRunId: run.parentRunId,
    status: run.status,
    options: run.options,
    models: run.models,
    estimate: run.estimate,
    usage: run.usage,
    jobs,
    proposals,
    digest: digest
      ? {
          fileId: digest.fileId,
          summary: digest.summary,
          keyPoints: digest.keyPoints,
          sections: digest.sections,
          meta: digest.meta,
          editedByUser: digest.editedByUser,
        }
      : null,
    readings: repos.readings.listByRun(run.id).map((r) => ({
      id: r.id,
      kind: r.kind,
      quality: r.quality,
      pages: r.pages,
      durationMs: r.durationMs,
    })),
    segments,
    error: run.error,
    errorFriendly: run.error ? friendlyError(run.error) : null,
    timeline: runTimeline(repos, run),
    failedTaskType: (run.params.failedTask as { type?: string } | undefined)?.type ?? null,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}
