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
import { applyMailApplications, syncMailReviewNotification } from "../mail/applications";
import { digestMail, type MailClassifier, syncDigestLabels } from "../mail/digest";
import { archiveStaleFeed, markAutoAnalyses } from "../mail/feed";
import { openMailPostingLinks } from "../mail/postings";
import { assessPendingMail } from "../mail/process";
import { refreshProvisionalScores } from "../mail/provisional-score";
import { mailRedoLocked } from "../mail/redo";
import type { MailSource } from "../mail/source";
import { syncMail } from "../mail/sync";
import { applyMailUpdates } from "../mail/updates";
import type { FetchPostingOptions } from "../postings/fetch/fetch";
import { remindTodos, todoUrl } from "../todos/notify";

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
  // F14-6/7: pré-análise automática do feed acima do corte, com teto por dia
  "postings.auto_analyze": {
    id: "postings.auto_analyze",
    defaultIntervalMinutes: 60,
    minIntervalMinutes: 10,
  },
  // F14-9: vagas do feed sem interação há 30 dias saem do feed
  "postings.feed_archive": {
    id: "postings.feed_archive",
    defaultIntervalMinutes: DAY,
    minIntervalMinutes: 60,
  },
  "captures.prune": { id: "captures.prune", defaultIntervalMinutes: DAY, minIntervalMinutes: 60 },
  "job_applications.archive": {
    id: "job_applications.archive",
    defaultIntervalMinutes: DAY,
    minIntervalMinutes: 60,
  },
  // F15-4: prazos das tarefas; na primeira volta depois de ligar, avisa o que venceu com o computador desligado
  "todos.reminders": { id: "todos.reminders", defaultIntervalMinutes: 15, minIntervalMinutes: 5 },
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
  /** F14/M4: serviços do worker (modelo, extração da vaga, busca do link); ausentes nos testes que não usam. */
  services: ScheduledServices;
}

export interface ScheduledServices {
  classifyMail?: MailClassifier | null;
  enqueuePostingExtract?: (postingId: string) => Promise<void>;
  fetchOptions?: FetchPostingOptions;
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

/** Lembretes das tarefas (F15/M2): vencidas e as que vencem em até 24 h, cada uma uma vez. */
async function todosReminders(ctx: ScheduledContext) {
  const r = await remindTodos(ctx.repos, ctx.now, ctx.publish);
  for (const [list, action] of [
    [r.overdue, "vencida"],
    [r.dueSoon, "vence logo"],
  ] as const)
    for (const t of list)
      ctx.item({ kind: "todo", refId: t.id, label: t.title, action, href: todoUrl(t.id) });
  ctx.count("overdue", r.overdue.length);
  ctx.count("due_soon", r.dueSoon.length);
  ctx.log("info", `${r.overdue.length} vencida(s), ${r.dueSoon.length} vencendo em até 24 h`);
}

/** Handlers por tarefa; mutável só para os testes trocarem um handler. */
/** Leitura do Gmail (F14/M2): baixa os e-mails novos de vagas; o processamento vem nos marcos seguintes. */
async function mailSync(ctx: ScheduledContext) {
  if (mailRedoLocked(ctx.repos, ctx.now)) {
    ctx.log("info", "Desfazendo uma leitura agora; esta execução fica para depois");
    return;
  }
  const source = ctx.mailSource();
  await syncMail({ repos: ctx.repos, dataDir: ctx.dataDir, source, ctx });
  // M3: risco, pré-filtro e quarentena do que foi baixado (nesta ou em execuções anteriores)
  await assessPendingMail({ repos: ctx.repos, dataDir: ctx.dataDir, source, ctx });
  // M4: alertas viram vagas do feed, o resto fica classificado; os links abrem devagar; processado ganha etiqueta e lido
  await digestMail({
    repos: ctx.repos,
    dataDir: ctx.dataDir,
    ctx,
    classify: ctx.services.classifyMail ?? null,
  });
  // M5: confirmações e negativas viram candidaturas (ou encerram), com a data e a hora do e-mail
  // candidaturas (M5) e atualizações (M6) em ordem cronológica entre si: cada passada só aplica o que é anterior ao
  // mais antigo pendente da outra; alterna até não sobrar progresso (revisão do M6, #13)
  for (let pass = 0; pass < 20; pass++) {
    const a = await applyMailApplications({ repos: ctx.repos, dataDir: ctx.dataDir, ctx });
    const b = await applyMailUpdates({ repos: ctx.repos, dataDir: ctx.dataDir, ctx });
    const progress = a.created + a.closed + a.noted + a.review + b.noted + b.review + b.contacts;
    if (!progress) break;
  }
  await syncMailReviewNotification(ctx.repos, ctx.publish);
  // F14-16: score provisório (cargo, senioridade e local) das vagas do feed ainda sem o completo
  const provisional = refreshProvisionalScores(ctx.repos);
  if (provisional) ctx.count("provisional_scores", provisional);
  // etiqueta e lido antes dos links (que podem levar minutos), para o Gmail refletir logo o que foi processado
  if (source) await syncDigestLabels({ repos: ctx.repos, source, ctx });
  if (ctx.services.enqueuePostingExtract)
    await openMailPostingLinks({
      repos: ctx.repos,
      ctx,
      enqueueExtract: ctx.services.enqueuePostingExtract,
      ...(ctx.services.fetchOptions ? { fetchOptions: ctx.services.fetchOptions } : {}),
    });
}

export const SCHEDULED_TASK_HANDLERS: Record<ScheduledTaskId, ScheduledHandler> = {
  "mail.sync": mailSync,
  "postings.auto_analyze": (ctx) => markAutoAnalyses(ctx),
  "postings.feed_archive": (ctx) => archiveStaleFeed(ctx),
  "captures.prune": capturesPrune,
  "job_applications.archive": jobApplicationsArchive,
  "todos.reminders": todosReminders,
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
  services?: ScheduledServices;
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
    services: input.services ?? {},
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
