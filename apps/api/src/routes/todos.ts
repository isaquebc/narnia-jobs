import {
  createTodo,
  listTodos,
  moveTodo,
  type Repos,
  removeTodo,
  resolveTodoNotifications,
  TodoError,
  updateTodo,
} from "@narnia-jobs/core";
import {
  TodoCreateSchema,
  TodoFilterSchema,
  TodoMoveSchema,
  TodoPatchSchema,
  TodoSourceSchema,
} from "@narnia-jobs/shared";
import { type Context, Hono } from "hono";
import { apiError } from "../errors";
import type { EventBus } from "../events";
import { validate } from "./validate";

/**
 * Tarefas (F15/M1, plans/plan-v0/tasks/F15-tarefas-e-avisos.md §2.1): o kanban lista com filtros, cria, edita, move e
 * apaga; cada mudança avisa as abas abertas (`todo.updated`).
 */
export function todosRoutes(deps: { repos: Repos; bus?: EventBus }) {
  const app = new Hono();
  const changed = (todoId: string | null) => deps.bus?.emit({ type: "todo.updated", todoId });
  const publish = (e: Parameters<EventBus["emit"]>[0]) => deps.bus?.emit(e);
  const fail = (c: Context, e: unknown) => {
    if (e instanceof TodoError) return apiError(c, 404, e.code, e.message);
    throw e;
  };

  app.get("/api/todos", (c) => {
    const q = c.req.query();
    const source = TodoSourceSchema.safeParse(q.source);
    const f = TodoFilterSchema.parse({
      ...(q.q ? { q: q.q } : {}),
      ...(q.tag ? { tag: q.tag } : {}),
      ...(source.success ? { source: source.data } : {}),
      ...(q.applicationId ? { applicationId: q.applicationId } : {}),
      ...(q.overdue === "1" || q.overdue === "true" ? { overdue: true } : {}),
    });
    return c.json(listTodos(deps.repos, f));
  });

  app.post("/api/todos", validate("json", TodoCreateSchema), (c) => {
    try {
      const t = createTodo(deps.repos, c.req.valid("json"));
      changed(t.id);
      return c.json(t, 201);
    } catch (e) {
      return fail(c, e);
    }
  });

  app.patch("/api/todos/:id", validate("json", TodoPatchSchema), (c) => {
    try {
      const before = deps.repos.todos.get(c.req.param("id"));
      const body = c.req.valid("json");
      const t = updateTodo(deps.repos, c.req.param("id"), body);
      // prazo novo: os avisos do prazo antigo saem (os novos vêm na próxima volta dos lembretes)
      if (body.dueAt !== undefined && before && body.dueAt !== before.dueAt)
        for (const n of deps.repos.notifications.resolveSubject("todo", t.id, [
          "todo.due_soon",
          "todo.overdue",
        ]))
          publish({ type: "notification.updated", notification: n });
      changed(t.id);
      return c.json(t);
    } catch (e) {
      return fail(c, e);
    }
  });

  app.post("/api/todos/:id/move", validate("json", TodoMoveSchema), async (c) => {
    try {
      const t = moveTodo(deps.repos, c.req.param("id"), c.req.valid("json"));
      // feita: os avisos dela saem da bandeja
      if (t.status === "done") await resolveTodoNotifications(deps.repos, t.id, publish);
      changed(t.id);
      return c.json(t);
    } catch (e) {
      return fail(c, e);
    }
  });

  app.delete("/api/todos/:id", async (c) => {
    try {
      removeTodo(deps.repos, c.req.param("id"));
      await resolveTodoNotifications(deps.repos, c.req.param("id"), publish);
      changed(null);
      return c.body(null, 204);
    } catch (e) {
      return fail(c, e);
    }
  });

  return app;
}
