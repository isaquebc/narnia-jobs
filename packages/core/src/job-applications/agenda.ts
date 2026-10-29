import {
  JOB_APPLICATION_COLUMNS,
  type JobApplicationClosedReason,
  type JobApplicationColumn,
  type JobApplicationEvent,
  type JobApplicationEventInput,
  type JobApplicationEventPatch,
  type JobApplicationFunnel,
  type JobApplicationUpcoming,
  localToUtc,
} from "@narnia-jobs/shared";
import type { Repos } from "../db";
import { JobApplicationError } from "./index";

/**
 * Agenda das etapas, lembretes e funil (F07/M5). A pessoa digita data e hora no fuso dela; o banco guarda o instante
 * em UTC e o fuso usado (F07-3). Lembrete = evento não concluído de candidatura ativa que começa nas próximas `hours`
 * horas, ou que já passou (atrasado). Funil a partir do histórico das colunas.
 */
const mustApplication = (repos: Repos, id: string) => {
  const app = repos.jobApplications.get(id);
  if (!app) throw new JobApplicationError("not_found", "Candidatura não encontrada");
  return app;
};

const mustEvent = (repos: Repos, applicationId: string, eventId: string) => {
  const e = repos.jobApplicationEvents.get(eventId);
  if (!e || e.applicationId !== applicationId)
    throw new JobApplicationError("not_found", "Evento não encontrado");
  return e;
};

function utc(local: string, timezone: string): string {
  try {
    return localToUtc(local, timezone);
  } catch {
    throw new JobApplicationError("invalid_datetime", "Data, hora ou fuso inválidos");
  }
}

function checkStage(repos: Repos, applicationId: string, stageId: string | null | undefined) {
  if (!stageId) return;
  const app = mustApplication(repos, applicationId);
  if (!app.stages.some((s) => s.id === stageId))
    throw new JobApplicationError("stage_not_found", "Etapa não é desta candidatura");
}

export function addJobApplicationEvent(
  repos: Repos,
  applicationId: string,
  input: JobApplicationEventInput,
  now = new Date(),
): JobApplicationEvent {
  mustApplication(repos, applicationId);
  checkStage(repos, applicationId, input.stageId);
  const ev = repos.jobApplicationEvents.create(
    applicationId,
    {
      stageId: input.stageId ?? null,
      kind: input.kind,
      title: input.title.trim(),
      startsAt: utc(input.startsLocal, input.timezone),
      durationMin: input.durationMin ?? 60,
      timezone: input.timezone,
      location: input.location?.trim() || null,
      link: input.link?.trim() || null,
      notes: input.notes?.trim() || null,
    },
    now,
  );
  repos.jobApplications.touch(applicationId, now);
  return ev;
}

export function updateJobApplicationEvent(
  repos: Repos,
  applicationId: string,
  eventId: string,
  patch: JobApplicationEventPatch,
  now = new Date(),
): JobApplicationEvent {
  mustEvent(repos, applicationId, eventId);
  checkStage(repos, applicationId, patch.stageId);
  const out = repos.jobApplicationEvents.update(
    eventId,
    {
      ...(patch.kind ? { kind: patch.kind } : {}),
      ...(patch.title ? { title: patch.title.trim() } : {}),
      ...(patch.startsLocal && patch.timezone
        ? { startsAt: utc(patch.startsLocal, patch.timezone), timezone: patch.timezone }
        : {}),
      ...(patch.durationMin ? { durationMin: patch.durationMin } : {}),
      ...(patch.stageId !== undefined ? { stageId: patch.stageId } : {}),
      ...(patch.location !== undefined ? { location: patch.location?.trim() || null } : {}),
      ...(patch.link !== undefined ? { link: patch.link?.trim() || null } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
      ...(patch.done !== undefined ? { doneAt: patch.done ? now.toISOString() : null } : {}),
    },
    now,
  );
  repos.jobApplications.touch(applicationId, now);
  return out;
}

export function removeJobApplicationEvent(
  repos: Repos,
  applicationId: string,
  eventId: string,
  now = new Date(),
): void {
  mustEvent(repos, applicationId, eventId);
  repos.jobApplicationEvents.remove(eventId);
  repos.jobApplications.touch(applicationId, now);
}

export function upcomingJobApplicationEvents(
  repos: Repos,
  opts: { hours?: number } = {},
  now = new Date(),
): JobApplicationUpcoming {
  const until = new Date(now.getTime() + (opts.hours ?? 24) * 3_600_000).toISOString();
  const nowIso = now.toISOString();
  const withApp = (event: JobApplicationEvent) => {
    const app = repos.jobApplications.get(event.applicationId);
    const p = app ? repos.postings.get(app.postingId) : null;
    return {
      event,
      application: {
        id: event.applicationId,
        company: [p?.company, p?.client].filter(Boolean).join(" / ") || null,
        title: p?.title ?? null,
      },
    };
  };
  const pending = repos.jobApplicationEvents.pendingBefore(until);
  return {
    upcoming: pending.filter((e) => e.startsAt >= nowIso).map(withApp),
    overdue: pending.filter((e) => e.startsAt < nowIso).map(withApp),
  };
}

/** Ordem do avanço (Encerrado fica fora: é saída de qualquer coluna). */
const FLOW: JobApplicationColumn[] = ["applied", "first_interview", "in_process", "offer"];
const DAY = 86_400_000;

export function jobApplicationFunnel(repos: Repos): JobApplicationFunnel {
  const apps = repos.jobApplications.list();
  const moves = repos.jobApplications.moves();
  const byApp = new Map<string, typeof moves>();
  for (const m of moves) byApp.set(m.applicationId, [...(byApp.get(m.applicationId) ?? []), m]);
  const reached = new Map<JobApplicationColumn, number>();
  const stays = new Map<JobApplicationColumn, number[]>();
  for (const a of apps) {
    const list = byApp.get(a.id) ?? [];
    const visited = new Set(list.map((m) => m.to));
    visited.add(a.column);
    // pular colunas conta como ter passado pelas anteriores
    const top = Math.max(...[...visited].map((c) => FLOW.indexOf(c)));
    for (const [i, c] of FLOW.entries()) if (i <= top) reached.set(c, (reached.get(c) ?? 0) + 1);
    if (visited.has("closed")) reached.set("closed", (reached.get("closed") ?? 0) + 1);
    // passagens terminadas: da entrada numa coluna até a mudança seguinte
    list.forEach((m, i) => {
      const next = list[i + 1];
      if (!next) return;
      const days = (Date.parse(next.at) - Date.parse(m.at)) / DAY;
      stays.set(m.to, [...(stays.get(m.to) ?? []), days]);
    });
  }
  const closedReasons: Partial<Record<JobApplicationClosedReason, number>> = {};
  for (const a of apps)
    if (a.column === "closed" && a.closedReason)
      closedReasons[a.closedReason] = (closedReasons[a.closedReason] ?? 0) + 1;
  const rejectedByStage: Record<string, number> = {};
  for (const a of apps)
    if (a.column === "closed" && a.closedReason === "rejected" && a.closedStage)
      rejectedByStage[a.closedStage] = (rejectedByStage[a.closedStage] ?? 0) + 1;
  const avg = (xs: number[] | undefined) =>
    xs?.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null;
  return {
    total: apps.length,
    columns: JOB_APPLICATION_COLUMNS.map((c) => ({
      column: c,
      now: apps.filter((a) => a.column === c).length,
      reached: reached.get(c) ?? 0,
      avgDays: avg(stays.get(c)),
    })),
    rates: FLOW.slice(0, -1).map((from, i) => {
      const to = FLOW[i + 1] as JobApplicationColumn;
      const base = reached.get(from) ?? 0;
      return { from, to, rate: base === 0 ? null : (reached.get(to) ?? 0) / base };
    }),
    closedReasons,
    rejectedByStage,
  };
}
