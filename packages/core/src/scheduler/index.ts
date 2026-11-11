import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  SCHEDULED_TASK_IDS,
  type ScheduledRunItem,
  type ScheduledTask,
  type ScheduledTaskId,
  type ScheduledTaskPatch,
  type WsEvent,
} from "@narnia-jobs/shared";
import type { Repos } from "../db";
import { jobApplicationUrl } from "../job-applications/tools";
import { assessPendingMail } from "../mail/process";
import type { MailSource } from "../mail/source";
import { syncMail } from "../mail/sync";

/**
 * Agendador (F14-12, plans/plan-v0/tasks/F14-leitura-de-emails.md §2.6): as rotinas periódicas rodam no worker como
 * tarefa `scheduled.run` (fila `scheduled`, uma por vez); o laço do worker enfileira as devidas, e a execução grava log,
 * itens e a próxima execução. Substitui o `setInterval` diário do api.
 */
export const SCHEDULED_RUN_TASK = "scheduled.run";
export const SCHEDULED_RETENTION_DAYS_DEFAULT = 90;
export const SCHEDULED_RETENTION_KEY = "scheduler.retentionDays";

export interface ScheduledTaskDefinition {
  id: ScheduledTaskId;
  defaultIntervalMinutes: number;
  minIntervalMinutes: number;
}

const DAY = 24 * 60;
export const SCHEDULED_TASKS: Record<ScheduledTaskId, ScheduledTaskDefinition> = {
  // F14-8: 1 h por padrão, mínimo 10 min
  "mail.sync": { id: "mail.sync", defaultIntervalMinutes: 60, minIntervalMinutes: 10 },
  "captures.prune": { id: "captures.prune", defaultIntervalMinutes: DAY, minIntervalMinutes: 60 },
  "job_applications.archive": {
    id: "job_applications.archive",
    defaultIntervalMinutes: DAY,
    minIntervalMinutes: 60,
  },
};

export class ScheduledTaskError extends Error {
  constructor(
    readonly code: "interval_too_short" | "unknown_task",
    message: string,
  ) {
    super(message);
    this.name = "ScheduledTaskError";
  }
}

export interface ScheduledContext {
  repos: Repos;
  dataDir: string;
  now: Date;
  log(level: "info" | "warn" | "error", message: string): void;
  item(
    i: Omit<ScheduledRunItem, "id" | "at" | "detail" | "href" | "result"> &
      Partial<Omit<ScheduledRunItem, "id">>,
  ): void;
  count(key: string, n?: number): void;
  publish(event: WsEvent): Promise<void>;
  /** F14: fonte do Gmail com o token guardado; null quando não está conectado. */
  mailSource(): MailSource | null;
}

export type ScheduledHandler = (ctx: ScheduledContext) => Promise<void>;

/** Poda das capturas da extensão (F12 §5): as sem vaga nem formulário há 30 dias saem, com o HTML guardado. */
async function capturesPrune(ctx: ScheduledContext) {
  const ids = ctx.repos.extension.pruneCaptures(ctx.now);
  for (const id of ids) {
    rmSync(join(ctx.dataDir, "captures", `${id}.html`), { force: true });
    ctx.item({ kind: "capture", refId: id, label: id, action: "apagada" });
  }
  ctx.count("deleted", ids.length);
  ctx.log("info", `${ids.length} captura(s) apagada(s)`);
}

/** Candidaturas sem atividade há 40 dias ficam arquivadas (F07 §0-6); a web é avisada por candidatura. */
async function jobApplicationsArchive(ctx: ScheduledContext) {
  const ids = ctx.repos.jobApplications.archiveInactive(ctx.now);
  for (const id of ids) {
    const app = ctx.repos.jobApplications.get(id);
    const posting = app ? ctx.repos.postings.get(app.postingId) : null;
    const label = posting ? [posting.title, posting.company].filter(Boolean).join(" · ") || id : id;
    ctx.item({
      kind: "job_application",
      refId: id,
      label,
      action: "arquivada",
      href: jobApplicationUrl(id),
    });
    await ctx.publish({ type: "job_application.updated", applicationId: id });
  }
  ctx.count("archived", ids.length);
  ctx.log("info", `${ids.length} candidatura(s) arquivada(s) por inatividade`);
}

/** Handlers por tarefa; mutável só para os testes trocarem um handler. */
/** Leitura do Gmail (F14/M2): baixa os e-mails novos de vagas; o processamento vem nos marcos seguintes. */
async function mailSync(ctx: ScheduledContext) {
  const source = ctx.mailSource();
  await syncMail({ repos: ctx.repos, dataDir: ctx.dataDir, source, ctx });
  // M3: risco, pré-filtro e quarentena do que foi baixado (nesta ou em execuções anteriores)
  await assessPendingMail({ repos: ctx.repos, dataDir: ctx.dataDir, source, ctx });
}

export const SCHEDULED_TASK_HANDLERS: Record<ScheduledTaskId, ScheduledHandler> = {
  "mail.sync": mailSync,
  "captures.prune": capturesPrune,
  "job_applications.archive": jobApplicationsArchive,
};

const intervalOf = (repos: Repos, id: ScheduledTaskId) =>
  repos.scheduled.task(id).intervalMinutes ?? SCHEDULED_TASKS[id].defaultIntervalMinutes;

export function listScheduledTasks(repos: Repos): ScheduledTask[] {
  return SCHEDULED_TASK_IDS.map((id) => {
    const def = SCHEDULED_TASKS[id];
    const st = repos.scheduled.task(id);
    return {
      id,
      intervalMinutes: st.intervalMinutes ?? def.defaultIntervalMinutes,
      defaultIntervalMinutes: def.defaultIntervalMinutes,
      minIntervalMinutes: def.minIntervalMinutes,
      paused: st.paused,
      nextRunAt: st.nextRunAt,
      lastRun: repos.scheduled.lastRun(id),
      running: repos.scheduled.isRunning(id),
    };
  });
}

export function isScheduledTaskId(id: string): id is ScheduledTaskId {
  return (SCHEDULED_TASK_IDS as readonly string[]).includes(id);
}

/** Muda intervalo e/ou pausa; o intervalo novo recalcula a próxima execução a partir do início da última. */
export function updateScheduledTask(
  repos: Repos,
  id: ScheduledTaskId,
  patch: ScheduledTaskPatch,
  now = new Date(),
): ScheduledTask {
  const def = SCHEDULED_TASKS[id];
  if (patch.intervalMinutes !== undefined && patch.intervalMinutes < def.minIntervalMinutes)
    throw new ScheduledTaskError(
      "interval_too_short",
      `O intervalo mínimo desta tarefa é ${def.minIntervalMinutes} minuto(s)`,
    );
  const next: Partial<{ intervalMinutes: number; paused: boolean; nextRunAt: string | null }> = {};
  if (patch.paused !== undefined) next.paused = patch.paused;
  if (patch.intervalMinutes !== undefined) {
    next.intervalMinutes = patch.intervalMinutes;
    // nunca rodou: continua devida; rodou: a próxima conta do início da última
    const last = repos.scheduled.lastRun(id);
    if (last)
      next.nextRunAt = new Date(
        new Date(last.startedAt).getTime() + patch.intervalMinutes * 60_000,
      ).toISOString();
  }
  repos.scheduled.setTask(id, next, now.toISOString());
  return listScheduledTasks(repos).find((t) => t.id === id) as ScheduledTask;
}

/** Tarefas que o laço do worker deve enfileirar agora: não pausadas, sem execução em andamento e com a hora chegada. */
export function dueScheduledTasks(repos: Repos, now = new Date()): ScheduledTaskId[] {
  return SCHEDULED_TASK_IDS.filter((id) => {
    const st = repos.scheduled.task(id);
    if (st.paused || repos.scheduled.isRunning(id)) return false;
    return !st.nextRunAt || st.nextRunAt <= now.toISOString();
  });
}

export interface RunScheduledResult {
  id: string;
  status: "done" | "error";
  skipped?: boolean;
}

/**
 * Roda uma tarefa: grava a execução, marca a próxima (início + intervalo, antes de rodar, para um erro não fazer o
 * laço repetir sem parar), chama o handler com log/itens/contadores, fecha a execução e aplica a retenção.
 */
export async function runScheduledTask(input: {
  repos: Repos;
  dataDir: string;
  taskId: ScheduledTaskId;
  trigger: "schedule" | "manual";
  now?: Date;
  publish: (event: WsEvent) => Promise<void>;
  mailSource?: () => MailSource | null;
}): Promise<RunScheduledResult> {
  const { repos, taskId } = input;
  const handler = SCHEDULED_TASK_HANDLERS[taskId];
  if (!handler)
    throw new ScheduledTaskError("unknown_task", `Tarefa agendada desconhecida: ${taskId}`);
  const now = input.now ?? new Date();
  const clock = input.now ? () => now.toISOString() : () => new Date().toISOString();
  if (repos.scheduled.isRunning(taskId)) {
    const last = repos.scheduled.lastRun(taskId);
    return { id: last?.id ?? "", status: "done", skipped: true };
  }
  const startedAt = now.toISOString();
  const runId = repos.scheduled.startRun({ taskId, trigger: input.trigger, at: startedAt });
  // revisão do M1: o aviso à web é melhor esforço; falha do Redis não pode deixar a execução presa em "running"
  const publish = (event: WsEvent) => input.publish(event).catch(() => {});
  const counts: Record<string, number> = {};
  const ctx: ScheduledContext = {
    repos,
    dataDir: input.dataDir,
    now,
    log: (level, message) => repos.scheduled.log(runId, level, message, clock()),
    item: (i) =>
      repos.scheduled.item(runId, {
        at: clock(),
        detail: null,
        href: null,
        result: "ok",
        ...i,
        refId: i.refId ?? null,
      }),
    count: (key, n = 1) => {
      counts[key] = (counts[key] ?? 0) + n;
    },
    publish,
    mailSource: () => input.mailSource?.() ?? null,
  };
  let status: "done" | "error" = "done";
  let error: string | null = null;
  try {
    repos.scheduled.setTask(
      taskId,
      { nextRunAt: new Date(now.getTime() + intervalOf(repos, taskId) * 60_000).toISOString() },
      startedAt,
    );
    await publish({ type: "scheduled_run.updated", taskId, runId, status: "running" });
    await handler(ctx);
  } catch (e) {
    status = "error";
    error = e instanceof Error ? e.message : String(e);
    try {
      ctx.log("error", error);
    } catch {
      // o fechamento abaixo ainda grava o erro na execução
    }
  } finally {
    // sempre fecha a execução: uma em "running" tira a tarefa do laço (dueScheduledTasks)
    repos.scheduled.finishRun(runId, { status, counts, error, at: clock() });
  }
  try {
    const days =
      repos.settings.get<number>(SCHEDULED_RETENTION_KEY) ?? SCHEDULED_RETENTION_DAYS_DEFAULT;
    repos.scheduled.pruneRuns(new Date(now.getTime() - days * DAY * 60_000).toISOString());
  } catch {
    // retenção é limpeza: tenta de novo na próxima execução
  }
  await publish({ type: "scheduled_run.updated", taskId, runId, status });
  return { id: runId, status };
}
