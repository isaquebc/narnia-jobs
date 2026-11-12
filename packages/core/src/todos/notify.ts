import type { Notification, WsEvent } from "@narnia-jobs/shared";
import { formatInUserTz } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import type { TodoRecord } from "../db/repos/todos";

/**
 * Avisos das tarefas (F15/M2, plano §2.2): tarefa nova (do e-mail ou do recrutador), prazo em até 24 h e prazo vencido.
 * Cada aviso sai uma vez (marcado na tarefa); feita ou apagada, os avisos dela se resolvem. O vigia do sistema mostra
 * esses tipos como notificação nativa (F15-3).
 */
type Publish = (e: WsEvent) => Promise<void> | void;

export const TODO_DUE_SOON_MS = 24 * 60 * 60_000;
export const todoUrl = (id: string) => `/tarefas?id=${encodeURIComponent(id)}`;

const timeZone = (repos: Repos) => repos.users.get()?.timezone ?? "America/Sao_Paulo";
const when = (repos: Repos, iso: string) => formatInUserTz(iso, timeZone(repos), "DD/MM HH:mm");

function where(repos: Repos, t: TodoRecord): string | null {
  if (!t.applicationId) return null;
  const a = repos.jobApplications.get(t.applicationId);
  const p = a ? repos.postings.get(a.postingId) : null;
  return p ? [p.company, p.title].filter(Boolean).join(" · ") || null : null;
}

async function emit(
  publish: Publish | undefined,
  r: { notification: Notification; created: boolean },
) {
  await publish?.({
    type: r.created ? "notification.created" : "notification.updated",
    notification: r.notification,
  });
}

/** Tarefa nova que a pessoa não criou (e-mail, recrutador): avisa. */
export async function notifyTodoCreated(repos: Repos, t: TodoRecord, publish?: Publish) {
  const body = [where(repos, t), t.dueAt ? `Prazo: ${when(repos, t.dueAt)}` : null]
    .filter(Boolean)
    .join(" · ");
  const r = repos.notifications.upsert({
    kind: "todo.created",
    subjectKind: "todo",
    subjectId: t.id,
    title: `Nova tarefa: ${t.title}`,
    body: body || null,
    actionUrl: todoUrl(t.id),
  });
  await emit(publish, r);
  return r.notification;
}

/** Feita ou apagada: os avisos dela saem da bandeja. */
export async function resolveTodoNotifications(repos: Repos, todoId: string, publish?: Publish) {
  for (const n of repos.notifications.resolveSubject("todo", todoId))
    await publish?.({ type: "notification.updated", notification: n });
}

/**
 * Lembretes (rotina `todos.reminders`): vencidas e as que vencem em até 24 h, cada uma uma vez. Como o agendador roda
 * na primeira volta o que passou da hora, ligar o computador avisa o que venceu enquanto ele estava desligado (F15-4).
 */
export async function remindTodos(
  repos: Repos,
  now: Date,
  publish?: Publish,
): Promise<{ dueSoon: TodoRecord[]; overdue: TodoRecord[] }> {
  const at = now.toISOString();
  const out = { dueSoon: [] as TodoRecord[], overdue: [] as TodoRecord[] };
  for (const t of repos.todos.dueBefore(new Date(now.getTime() + TODO_DUE_SOON_MS).toISOString())) {
    const due = t.dueAt as string;
    const ctx = where(repos, t);
    if (due <= at) {
      if (t.notifiedOverdueAt) continue;
      // o aviso de "vence logo" perde o sentido: fica só o de vencida
      for (const n of repos.notifications.resolveSubject("todo", t.id, ["todo.due_soon"]))
        await publish?.({ type: "notification.updated", notification: n });
      const r = repos.notifications.upsert({
        kind: "todo.overdue",
        subjectKind: "todo",
        subjectId: t.id,
        title: `Tarefa vencida: ${t.title}`,
        body: [ctx, `Venceu em ${when(repos, due)}`].filter(Boolean).join(" · "),
        actionUrl: todoUrl(t.id),
        severity: "warning",
      });
      repos.todos.markNotified(t.id, "overdue", at);
      await emit(publish, r);
      out.overdue.push(t);
    } else {
      if (t.notifiedDueSoonAt) continue;
      const r = repos.notifications.upsert({
        kind: "todo.due_soon",
        subjectKind: "todo",
        subjectId: t.id,
        title: `Tarefa vence logo: ${t.title}`,
        body: [ctx, `Prazo: ${when(repos, due)}`].filter(Boolean).join(" · "),
        actionUrl: todoUrl(t.id),
      });
      repos.todos.markNotified(t.id, "due_soon", at);
      await emit(publish, r);
      out.dueSoon.push(t);
    }
  }
  return out;
}
