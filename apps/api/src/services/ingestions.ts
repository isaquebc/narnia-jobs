import {
  factChangeOf,
  friendlyError,
  type IngestionRunRecord,
  type ProposalRecord,
  type Repos,
  runJobs,
  type SegmentRecord,
  STAGES,
} from "@narnia-jobs/core";
import type {
  FactProposal,
  ProposalExperienceRef,
  ProposalReference,
  RunOrigin,
} from "@narnia-jobs/shared";
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

/** "Cargo · Empresa · início–fim" de uma experiência (do perfil ou proposta). */
export function experienceLabel(e: {
  title: string;
  company: string;
  startDate: string;
  endDate?: string | null | undefined;
  isCurrent: boolean;
}): string {
  const end = e.isCurrent ? "atual" : (e.endDate ?? "");
  return `${e.title} · ${e.company} · ${e.startDate}${end ? `–${end}` : ""}`;
}

/** Rótulo do fato do perfil com que a proposta bateu (match existente ou conflito). */
function factLabel(repos: Repos, kind: string, id: string): string | null {
  const f = repos.facts;
  switch (kind) {
    case "experience": {
      const e = f.experiences.get(id);
      return e ? experienceLabel(e) : null;
    }
    case "achievement":
      return f.achievements.get(id)?.text ?? null;
    case "education": {
      const e = f.education.get(id);
      return e ? `${e.course} · ${e.institution}` : null;
    }
    case "skill":
      return f.skills.get(id)?.name ?? null;
    case "language": {
      const l = f.languages.get(id);
      return l ? `${l.name} · ${l.level}` : null;
    }
    case "project":
      return f.projects.get(id)?.name ?? null;
    default:
      return null;
  }
}

/**
 * Onde cada card entra (pedido do dono, 2026-10-14): o fato do perfil que ele repete e, na conquista, a experiência
 * dona — uma do perfil (pelo id, ou pela experiência repetida desta ingestão) ou uma nova proposta nesta ingestão.
 */
export function proposalReferences(
  repos: Repos,
  proposals: ProposalRecord[],
): Map<string, ProposalReference> {
  const experiences = proposals.filter((p) => p.kind === "experience");
  const fromProfile = (
    id: string,
    proposalId: string | null = null,
  ): ProposalExperienceRef | null => {
    const e = repos.facts.experiences.get(id);
    return e
      ? { source: "profile", label: experienceLabel(e), experienceId: e.id, proposalId }
      : null;
  };
  const out = new Map<string, ProposalReference>();
  for (const p of proposals) {
    const existing =
      p.match !== "new" && p.matchTargetId ? factLabel(repos, p.kind, p.matchTargetId) : null;
    let experience: ProposalExperienceRef | null = null;
    if (p.proposal.kind === "achievement") {
      const data: Record<string, unknown> = { ...p.proposal.data, ...(p.editedData ?? {}) };
      if (p.editedData && "experienceIndex" in p.editedData && !("experienceId" in p.editedData))
        delete data.experienceId;
      const index = typeof data.experienceIndex === "number" ? data.experienceIndex : null;
      if (typeof data.experienceId === "string") experience = fromProfile(data.experienceId);
      else if (index !== null) {
        const e = experiences[index];
        const known =
          e?.targetId ?? (e && e.match !== "new" && e.matchTargetId ? e.matchTargetId : null);
        if (e && known) experience = fromProfile(known, e.id);
        else if (e?.proposal.kind === "experience")
          experience = {
            source: "run",
            label: experienceLabel(e.proposal.data),
            proposalId: e.id,
            experienceIndex: index,
          };
      }
    }
    out.set(p.id, { existing, experience });
  }
  return out;
}

const EXCERPT = 120;

/** De onde veio a execução (pedido do dono, 2026-10-14): várias ingestões na revisão ficam distinguíveis. */
export function runOrigin(repos: Repos, run: IngestionRunRecord): RunOrigin {
  const file = run.fileId ? repos.sourceFiles.get(run.fileId) : null;
  const repoNames = run.params.repos ?? [];
  const name = file?.originalName ?? (repoNames.length > 0 ? repoNames.join(", ") : null);
  let excerpt: string | null = null;
  if (run.source === "text") {
    const text = repos.readings
      .segmentsByRun(run.id)
      .map((s) => s.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) excerpt = text.length > EXCERPT ? `${text.slice(0, EXCERPT).trimEnd()}…` : text;
  }
  const chatTitle = run.chatSessionId
    ? (repos.chatSessions.get(run.chatSessionId)?.title ?? null)
    : null;
  return { name, excerpt, chatTitle };
}

/** Experiências do perfil para escolher a dona de uma conquista. */
export function profileExperiences(repos: Repos) {
  return repos.facts.experiences.list().map((e) => ({ id: e.id, label: experienceLabel(e) }));
}

/** Proposta para a revisão (F03 §2.9-6): reconciliação, evidência literal, selo e perfis sugeridos. */
export function toProposalDto(
  p: ProposalRecord,
  segments: SegmentRecord[],
  refs?: Map<string, ProposalReference>,
) {
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
    checkReason: p.checkReason,
    suggestedProfiles: p.suggestedProfiles,
    ...(refs?.get(p.id) ? { reference: refs.get(p.id) } : {}),
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
  const records = repos.proposals.listByRun(run.id);
  const refs = proposalReferences(repos, records);
  const proposals = records.map((p) => toProposalDto(p, segments, refs));
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
    childRunIds: repos.ingestionRuns.listChildren(run.id).map((r) => r.id),
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
    origin: runOrigin(repos, run),
    factChange: factChangeOf(run),
    profileExperiences: profileExperiences(repos),
    failedTaskType: (run.params.failedTask as { type?: string } | undefined)?.type ?? null,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}
