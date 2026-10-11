import type { Job } from "@narnia-jobs/shared";
import type { IngestionRunRecord } from "../db/repos/ingestion-runs";
import { type FriendlyError, friendlyError } from "../errors/friendly";
import { taskOfJob } from "../jobs/tasks";
import { planStages, type StageName } from "./chain";
import { INGEST_TASKS } from "./github-run";
import { isJobStale } from "./heal";

/**
 * Linha do tempo da execução (plano de comunicação C1, 2026-10-11): as etapas reais, na ordem, com estado, progresso,
 * duração e último sinal, calculadas de jobs + relatório (sem tabela nova). Resolve "repositório Concluído com a
 * execução Analisando": a tela mostra que faltam síntese, comparação e conferência, e qual delas está rodando.
 */
export type TimelineStepState = "pending" | "running" | "done" | "skipped" | "error" | "stuck";

export interface TimelineStep {
  key: string;
  state: TimelineStepState;
  progress?: { done: number; total: number };
  /** Repositórios que falharam (etapa de repositórios do GitHub). */
  failures?: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  lastActivityAt?: string | null;
  error?: FriendlyError | null;
}

export interface Timeline {
  steps: TimelineStep[];
  /** Posição (1-based) da primeira etapa não terminada; nula quando tudo terminou. */
  current: number | null;
  total: number;
  /** Alguma etapa ativa está sem sinal há mais de 2 minutos. */
  stuck: boolean;
}

const GITHUB_STEPS = [
  "prepare",
  "repos",
  "synthesis",
  "reconcile",
  "review_check",
  "review",
] as const;
const TASK_TO_STEP: Record<string, (typeof GITHUB_STEPS)[number]> = {
  [INGEST_TASKS.githubPrepare]: "prepare",
  [INGEST_TASKS.githubRepo]: "repos",
  [INGEST_TASKS.githubSynthesis]: "synthesis",
  [INGEST_TASKS.reconcile]: "reconcile",
  [INGEST_TASKS.reviewCheck]: "review_check",
};
const REPO_TERMINAL = new Set(["done", "skipped_empty", "skipped_budget", "error"]);

const duration = (a?: string | null, b?: string | null) =>
  a && b ? Math.max(0, Date.parse(b) - Date.parse(a)) : null;

function fromJobs(key: string, jobs: Job[], now: Date, runError: string | null): TimelineStep {
  if (jobs.length === 0) return { key, state: "pending" };
  const started =
    jobs
      .map((j) => j.startedAt)
      .filter((x): x is string => !!x)
      .sort()[0] ?? null;
  const allDone = jobs.every((j) => j.status === "done");
  const finished = allDone
    ? (jobs
        .map((j) => j.finishedAt)
        .filter((x): x is string => !!x)
        .sort()
        .at(-1) ?? null)
    : null;
  const last =
    jobs
      .map((j) => j.updatedAt ?? null)
      .filter((x): x is string => !!x)
      .sort()
      .at(-1) ?? null;
  let state: TimelineStepState;
  const failed = jobs.find((j) => j.status === "error");
  if (jobs.some((j) => isJobStale(j, now))) state = "stuck";
  else if (jobs.some((j) => j.status === "active" || j.status === "stalled")) state = "running";
  else if (failed) state = "error";
  else if (allDone) state = "done";
  else if (jobs.every((j) => j.status === "cancelled")) state = "skipped";
  else state = "running"; // na fila: a etapa já começou do ponto de vista do usuário
  return {
    key,
    state,
    startedAt: started,
    finishedAt: finished,
    durationMs: duration(started, finished),
    lastActivityAt: last,
    error: state === "error" ? friendlyError(failed?.error ?? runError ?? "") : null,
  };
}

function finish(steps: TimelineStep[], run: IngestionRunRecord): Timeline {
  const review = steps.at(-1);
  if (review) {
    if (run.status === "review") review.state = "running";
    else if (run.status === "done") review.state = "done";
    else if (run.status === "cancelled") review.state = "skipped";
  }
  // execução em erro sem etapa marcada: a primeira não terminada leva o erro
  if (run.status === "error" && !steps.some((s) => s.state === "error")) {
    const target = steps.find((s) => s.state !== "done" && s.state !== "skipped");
    if (target) {
      target.state = "error";
      target.error = friendlyError(run.error ?? "");
    }
  }
  const idx = steps.findIndex((s) => s.state !== "done" && s.state !== "skipped");
  return {
    steps,
    current: idx >= 0 ? idx + 1 : null,
    total: steps.length,
    stuck: steps.some((s) => s.state === "stuck"),
  };
}

export function buildTimeline(input: {
  run: IngestionRunRecord;
  jobs: Job[];
  /** CV/texto: o arquivo é PDF (OCR e leitura pelo modelo só existem para PDF). */
  isPdf?: boolean;
  now?: Date;
}): Timeline {
  const { run, jobs } = input;
  const now = input.now ?? new Date();
  if (run.source === "github") {
    const byStep = new Map<string, Job[]>();
    for (const j of jobs) {
      const type = taskOfJob(j)?.type ?? j.type;
      const step = TASK_TO_STEP[type];
      if (step) byStep.set(step, [...(byStep.get(step) ?? []), j]);
    }
    const steps = GITHUB_STEPS.map((key) =>
      key === "review"
        ? ({ key, state: "pending" } as TimelineStep)
        : fromJobs(key, byStep.get(key) ?? [], now, run.error),
    );
    const repos = steps[1] as TimelineStep;
    const rows = run.report?.repos ?? [];
    if (rows.length > 0) {
      const done = rows.filter((r) => REPO_TERMINAL.has(r.status)).length;
      repos.progress = { done, total: rows.length };
      repos.failures = rows.filter((r) => r.status === "error").length;
      if (done === rows.length && repos.state !== "stuck") {
        repos.state = "done";
        repos.error = null;
      } else if (
        repos.state === "pending" &&
        steps[0]?.state === "done" &&
        run.status === "running"
      )
        repos.state = "running";
    }
    return finish(steps, run);
  }
  const planned: StageName[] = planStages({
    isPdf: input.isPdf ?? false,
    options: (run.options as { ocr: boolean; modelRead: boolean }) ?? {
      ocr: false,
      modelRead: false,
    },
  });
  const steps: TimelineStep[] = planned.map((stage) =>
    fromJobs(
      stage,
      jobs.filter((j) => j.type === stage),
      now,
      run.error,
    ),
  );
  steps.push({ key: "review", state: "pending" });
  return finish(steps, run);
}
