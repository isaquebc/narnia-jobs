import type { RunReport } from "@narnia-jobs/shared";

/**
 * Relatório da execução (F03-3 §2), salvo ao final: estimado × real por repositório, paradas do freio, o que
 * ficou de fora e o texto da síntese. Funções puras e imutáveis; quem grava é `ingestionRuns.setReport`.
 */
type RepoStatus = RunReport["repos"][number]["status"];

export function newRunReport(i: {
  model: string;
  budget: number;
  startedAt: string | null;
  repos: { fullName: string; estimatedTokens: number }[];
}): RunReport {
  const repos = i.repos.map((r) => ({
    fullName: r.fullName,
    estimatedTokens: r.estimatedTokens,
    usedTokens: 0,
    status: "pending" as RepoStatus,
  }));
  return {
    model: i.model,
    budget: i.budget,
    totals: { estimated: repos.reduce((n, r) => n + r.estimatedTokens, 0), used: 0 },
    repos,
    stops: [],
    skipped: [],
    startedAt: i.startedAt,
    finishedAt: null,
    synthesis: null,
  };
}

const totals = (r: RunReport, extraUsed = 0): RunReport["totals"] => ({
  estimated: r.repos.reduce((n, x) => n + x.estimatedTokens, 0),
  used: r.repos.reduce((n, x) => n + x.usedTokens, 0) + extraUsed,
});

export function markRepo(
  report: RunReport,
  fullName: string,
  u: { status: RepoStatus; usedTokens: number; stoppedReason?: string },
): RunReport {
  if (!report.repos.some((r) => r.fullName === fullName)) {
    throw new Error(`Repositório fora da execução: ${fullName}`);
  }
  const repos = report.repos.map((r) =>
    r.fullName === fullName
      ? {
          ...r,
          status: u.status,
          usedTokens: u.usedTokens,
          ...(u.stoppedReason ? { stoppedReason: u.stoppedReason } : {}),
        }
      : r,
  );
  const next = { ...report, repos };
  return { ...next, totals: totals(next) };
}

export function addStop(
  report: RunReport,
  stop: { at: string; reason: string; usedTokens: number },
): RunReport {
  return { ...report, stops: [...report.stops, stop] };
}

/** Fecha o relatório: totais, pulados por orçamento e síntese (o uso da síntese/revisor entra em `extraUsed`). */
export function finishReport(
  report: RunReport,
  f: { finishedAt: string; synthesis: string | null; extraUsedTokens?: number },
): RunReport {
  return {
    ...report,
    finishedAt: f.finishedAt,
    synthesis: f.synthesis,
    skipped: report.repos.filter((r) => r.status === "skipped_budget").map((r) => r.fullName),
    totals: totals(report, f.extraUsedTokens ?? 0),
  };
}

/**
 * Refazer um repositório falho na mesma execução (plano de comunicação C4): a linha volta a pendente (uso e motivo
 * zerados) e a síntese é reaberta, para rodar de novo quando o repositório terminar.
 */
export function reopenRepo(report: RunReport, fullName: string): RunReport {
  if (!report.repos.some((r) => r.fullName === fullName)) {
    throw new Error(`Repositório fora da execução: ${fullName}`);
  }
  const repos = report.repos.map((r) => {
    if (r.fullName !== fullName) return r;
    const { stoppedReason: _gone, ...rest } = r;
    return { ...rest, status: "pending" as const, usedTokens: 0 };
  });
  const next = { ...report, repos, finishedAt: null, synthesis: null };
  return { ...next, totals: totals(next) };
}
