import { type IngestionRunRecord, type Repos, type SegmentRecord, STAGES } from "@narnia-jobs/core";
import type { FactProposal } from "@narnia-jobs/shared";

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

export function toIngestionResponse(repos: Repos, run: IngestionRunRecord) {
  const segments = repos.readings.segmentsByRun(run.id);
  const jobs = repos.jobs
    .list({ parentId: run.id, limit: 50 })
    .sort(
      (a, b) =>
        (STAGES[a.type as keyof typeof STAGES]?.order ?? 99) -
        (STAGES[b.type as keyof typeof STAGES]?.order ?? 99),
    );
  const proposals = repos.proposals.listByRun(run.id).map((p) => ({
    id: p.id,
    proposal: p.proposal,
    decision: p.decision === "skipped" ? ("rejected" as const) : p.decision,
    origin: inferOrigin(p.proposal, segments),
    editedData: p.editedData,
  }));
  const digest = run.fileId ? repos.digests.get(run.fileId) : null;
  return {
    id: run.id,
    fileId: run.fileId,
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
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}
