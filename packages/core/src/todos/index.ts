import type {
  TodoCreate,
  TodoFilter,
  TodoItem,
  TodoKind,
  TodoMove,
  TodoPatch,
} from "@narnia-jobs/shared";
import type { Repos } from "../db";
import type { TodoRecord } from "../db/repos/todos";

/**
 * Tarefas (F15 §2.1, plans/plan-v0/tasks/F15-tarefas-e-avisos.md): criar, editar, mover no kanban e listar com o que o
 * cartão precisa (a candidatura e o e-mail). As do e-mail usam `createMailTodo` (M3).
 */
export class TodoError extends Error {
  constructor(
    readonly code: "not_found" | "application_not_found",
    message: string,
  ) {
    super(message);
    this.name = "TodoError";
  }
}

/** Tag do tipo de ação pedida pelo e-mail (F15-2). */
export const TODO_KIND_TAG: Record<TodoKind, string> = {
  screening: "triagem",
  test: "teste",
  form: "formulário",
  documents: "documentos",
  interview: "entrevista",
  schedule: "agendar",
  other: "outra",
};

const mailUrl = (gmailId: string) => `https://mail.google.com/mail/u/0/#all/${gmailId}`;

function applicationOf(repos: Repos, id: string | null) {
  if (!id) return null;
  const a = repos.jobApplications.get(id);
  if (!a) return null;
  const p = repos.postings.get(a.postingId);
  return { id: a.id, company: p?.company ?? null, title: p?.title ?? null };
}

export function todoItem(repos: Repos, t: TodoRecord): TodoItem {
  const mail = t.mailMessageId ? repos.mail.get(t.mailMessageId) : null;
  const { notifiedDueSoonAt: _d, notifiedOverdueAt: _o, ...rest } = t;
  return {
    ...rest,
    application: applicationOf(repos, t.applicationId),
    mailUrl: mail ? mailUrl(mail.gmailId) : null,
  };
}

function checkApplication(repos: Repos, id: string | null | undefined) {
  if (!id) return null;
  const a = repos.jobApplications.get(id);
  if (!a) throw new TodoError("application_not_found", "Candidatura não encontrada");
  return a;
}

export function listTodos(repos: Repos, f: TodoFilter, now = new Date()) {
  return {
    todos: repos.todos.list(f, now.toISOString()).map((t) => todoItem(repos, t)),
    tags: repos.todos.tags(),
  };
}

/** Tarefa manual; ligada a uma candidatura, ganha a vaga dela. */
export function createTodo(repos: Repos, input: TodoCreate, now = new Date()): TodoItem {
  const app = checkApplication(repos, input.applicationId);
  const t = repos.todos.create(
    {
      title: input.title.trim(),
      note: input.note?.trim() || null,
      status: input.status ?? "todo",
      dueAt: input.dueAt ?? null,
      actionUrl: input.actionUrl ?? null,
      source: "manual",
      kind: null,
      tags: input.tags ?? [],
      applicationId: app?.id ?? null,
      postingId: app?.postingId ?? null,
      mailMessageId: null,
    },
    now.toISOString(),
  );
  return todoItem(repos, t);
}

export function updateTodo(repos: Repos, id: string, patch: TodoPatch, now = new Date()): TodoItem {
  if (!repos.todos.get(id)) throw new TodoError("not_found", "Tarefa não encontrada");
  const app =
    patch.applicationId !== undefined ? checkApplication(repos, patch.applicationId) : undefined;
  const t = repos.todos.update(
    id,
    {
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.note !== undefined ? { note: patch.note?.trim() || null } : {}),
      ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt } : {}),
      ...(patch.actionUrl !== undefined ? { actionUrl: patch.actionUrl } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(app !== undefined
        ? { applicationId: app?.id ?? null, postingId: app?.postingId ?? null }
        : {}),
    },
    now.toISOString(),
  ) as TodoRecord;
  return todoItem(repos, t);
}

export function moveTodo(repos: Repos, id: string, m: TodoMove, now = new Date()): TodoItem {
  const t = repos.todos.move(id, m.status, m.index, now.toISOString());
  if (!t) throw new TodoError("not_found", "Tarefa não encontrada");
  return todoItem(repos, t);
}

export function removeTodo(repos: Repos, id: string): void {
  if (!repos.todos.get(id)) throw new TodoError("not_found", "Tarefa não encontrada");
  repos.todos.remove(id);
}
