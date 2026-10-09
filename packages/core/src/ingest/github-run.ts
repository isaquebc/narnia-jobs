import type { IngestionDecisionRequest } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import type { IngestionRunRecord } from "../db/repos/ingestion-runs";
import type { QueueName } from "./chain";
import { IngestError } from "./errors";

/**
 * Orquestração da execução do GitHub (F03 §2.1, §2.6), compartilhada por api e worker: tipos e chaves das tarefas,
 * confirmação, decisão no freio e cancelamento. Funções síncronas sobre o banco; quem enfileira é o chamador
 * (BullMQ na api, `enqueueTask` no worker), a partir dos `TaskRequest` devolvidos.
 */
export const INGEST_TASKS = {
  githubPrepare: "ingest.github.prepare",
  githubRepo: "ingest.github.repo",
  githubSynthesis: "ingest.github.synthesis",
  reconcile: "ingest.reconcile",
  reviewCheck: "ingest.review_check",
} as const;

export interface TaskRequest {
  queue: QueueName;
  type: string;
  key: string;
  payload: Record<string, unknown>;
}

const safeKey = (s: string) => s.replace(/[/:]/g, "__");

export const prepareTask = (runId: string): TaskRequest => ({
  queue: "ingest",
  type: INGEST_TASKS.githubPrepare,
  key: runId,
  payload: { runId },
});

/** Repositórios rodam na fila `extract` (concorrência 2) para não bloquear a leitura de CVs na `ingest`. */
export const repoTask = (runId: string, fullName: string): TaskRequest => ({
  queue: "extract",
  type: INGEST_TASKS.githubRepo,
  key: `${runId}__${safeKey(fullName)}`,
  payload: { runId, fullName },
});

export const synthesisTask = (runId: string): TaskRequest => ({
  queue: "ingest",
  type: INGEST_TASKS.githubSynthesis,
  key: runId,
  payload: { runId },
});

export const reconcileTask = (runId: string): TaskRequest => ({
  queue: "ingest",
  type: INGEST_TASKS.reconcile,
  key: runId,
  payload: { runId },
});

export const reviewCheckTask = (runId: string): TaskRequest => ({
  queue: "ingest",
  type: INGEST_TASKS.reviewCheck,
  key: runId,
  payload: { runId },
});

/** Repositórios ainda não analisados (relatório da execução; sem relatório, os escolhidos). */
export function pendingRepos(run: IngestionRunRecord): string[] {
  if (run.report)
    return run.report.repos.filter((r) => r.status === "pending").map((r) => r.fullName);
  return [...(run.params.repos ?? [])];
}

function load(repos: Repos, runId: string): IngestionRunRecord {
  const run = repos.ingestionRuns.get(runId);
  if (!run) throw new IngestError("run_not_found", `Execução não encontrada: ${runId}`);
  return run;
}

/** Confirmação do orçamento (GitHub sempre confirma, F03-13): `queued` e uma tarefa por repositório pendente. */
export function confirmRun(repos: Repos, runId: string): TaskRequest[] {
  const run = load(repos, runId);
  if (run.status !== "awaiting_confirmation") {
    throw new IngestError("invalid_state", `A execução não espera confirmação (${run.status})`);
  }
  repos.ingestionRuns.setStatus(runId, "queued");
  return pendingRepos(run).map((r) => repoTask(runId, r));
}

const DECIDABLE = new Set(["awaiting_decision", "paused"]);

/**
 * Decisão no freio (F03-3 §6): continuar (soma `extraBudget` e reenfileira só os pendentes), encerrar com o feito
 * (pendentes viram `skipped_budget` e a síntese roda sobre o que existe) ou deixar para depois (`paused`).
 */
export function decideRun(
  repos: Repos,
  runId: string,
  d: Pick<IngestionDecisionRequest, "action" | "extraBudget">,
): { status: IngestionRunRecord["status"]; tasks: TaskRequest[] } {
  const run = load(repos, runId);
  if (!DECIDABLE.has(run.status)) {
    throw new IngestError("invalid_state", `A execução não espera decisão (${run.status})`);
  }
  if (d.action === "later") {
    repos.ingestionRuns.setStatus(runId, "paused");
    return { status: "paused", tasks: [] };
  }
  if (d.action === "continue") {
    if (run.budget && d.extraBudget) {
      repos.ingestionRuns.setBudget(runId, {
        ...run.budget,
        amount: run.budget.amount + d.extraBudget,
      });
    }
    repos.ingestionRuns.setStatus(runId, "running");
    const pending = pendingRepos(run);
    return {
      status: "running",
      tasks: pending.length > 0 ? pending.map((r) => repoTask(runId, r)) : [synthesisTask(runId)],
    };
  }
  if (run.report) {
    repos.ingestionRuns.setReport(runId, {
      ...run.report,
      repos: run.report.repos.map((r) =>
        r.status === "pending"
          ? { ...r, status: "skipped_budget" as const, stoppedReason: "encerrado pelo usuário" }
          : r,
      ),
    });
  }
  repos.ingestionRuns.setStatus(runId, "running");
  return { status: "running", tasks: [synthesisTask(runId)] };
}

const TERMINAL = new Set(["done", "error", "cancelled"]);

/** Cancelamento entre repositórios: as tarefas na fila veem `cancelled` e não chamam o modelo. */
export function cancelRun(repos: Repos, runId: string): void {
  const run = load(repos, runId);
  if (TERMINAL.has(run.status)) {
    throw new IngestError("run_closed", `A execução já terminou (${run.status})`);
  }
  repos.ingestionRuns.setStatus(runId, "cancelled");
}
