import type { WsEvent } from "@narnia-jobs/shared";
import { NATIVE_NOTIFICATION_KINDS } from "@narnia-jobs/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createRepos,
  createTodo,
  migrate,
  notifyTodoCreated,
  openDatabase,
  type Repos,
  remindTodos,
  resolveTodoNotifications,
  runScheduledTask,
} from "../../src";

/**
 * F15/M2 · avisos das tarefas: tarefa nova avisa; a rotina `todos.reminders` avisa o que vence em 24 h e o que venceu
 * (inclusive com o computador desligado: a primeira volta depois de ligar pega tudo), cada aviso uma vez.
 */
const NOW = new Date("2026-11-12T12:00:00.000Z");
const h = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString();

describe("F15/M2 · avisos das tarefas", () => {
  let repos: Repos;
  let events: WsEvent[];
  const publish = async (e: WsEvent) => {
    events.push(e);
  };
  beforeEach(() => {
    const db = openDatabase(":memory:");
    migrate(db);
    repos = createRepos(db);
    events = [];
  });

  it("tarefa nova avisa (tipo que o vigia do sistema mostra); feita, o aviso se resolve", async () => {
    const t = createTodo(repos, { title: "Fazer a triagem", dueAt: h(30) }, NOW);
    const n = await notifyTodoCreated(repos, repos.todos.get(t.id) as never, publish);
    expect(n).toMatchObject({ kind: "todo.created", title: "Nova tarefa: Fazer a triagem" });
    expect(n.body).toMatch(/^Prazo: 13\/11 /);
    expect(NATIVE_NOTIFICATION_KINDS).toContain("todo.created");
    expect(events.map((e) => e.type)).toEqual(["notification.created"]);
    await resolveTodoNotifications(repos, t.id, publish);
    expect(repos.notifications.get(n.id)?.resolvedAt).not.toBeNull();
  });

  it("vence em 24 h e vencida, cada aviso uma vez; sem prazo, longe ou feita não avisa", async () => {
    const soon = createTodo(repos, { title: "Teste online", dueAt: h(5) }, NOW);
    const late = createTodo(repos, { title: "Formulário", dueAt: h(-30) }, NOW);
    createTodo(repos, { title: "Sem prazo" }, NOW);
    createTodo(repos, { title: "Longe", dueAt: h(72) }, NOW);
    const done = createTodo(repos, { title: "Feita", dueAt: h(-1), status: "done" }, NOW);

    const r = await remindTodos(repos, NOW, publish);
    expect(r.dueSoon.map((t) => t.id)).toEqual([soon.id]);
    expect(r.overdue.map((t) => t.id)).toEqual([late.id]);
    expect(r.overdue.some((t) => t.id === done.id)).toBe(false);
    const open = repos.notifications.list();
    expect(open.map((n) => n.kind).sort()).toEqual(["todo.due_soon", "todo.overdue"]);
    expect(open.find((n) => n.kind === "todo.overdue")?.severity).toBe("warning");

    // segunda volta: nada de novo
    const again = await remindTodos(repos, NOW, publish);
    expect(again.dueSoon.length + again.overdue.length).toBe(0);

    // o prazo da que vencia logo passou: vira vencida e o "vence logo" sai
    const later = await remindTodos(repos, new Date(NOW.getTime() + 6 * 3_600_000), publish);
    expect(later.overdue.map((t) => t.id)).toEqual([soon.id]);
    expect(repos.notifications.list().map((n) => n.kind)).not.toContain("todo.due_soon");
  });

  it("computador desligado: a primeira execução depois de ligar avisa o que venceu enquanto estava desligado", async () => {
    const t = createTodo(repos, { title: "Mandar documentos", dueAt: h(2) }, NOW);
    // a última execução foi antes do prazo; o computador ficou desligado até o dia seguinte
    const run = await runScheduledTask({
      repos,
      dataDir: "/tmp/nao-usa",
      taskId: "todos.reminders",
      trigger: "schedule",
      now: new Date(NOW.getTime() + 20 * 3_600_000),
      publish,
    });
    expect(run.status).toBe("done");
    expect(repos.notifications.list().map((n) => [n.kind, n.subjectId])).toEqual([
      ["todo.overdue", t.id],
    ]);
    const detail = repos.scheduled.run(run.id);
    expect(detail?.items.map((i) => i.action)).toEqual(["vencida"]);
  });

  it("o vigia lê só os tipos dele, criados depois do cursor", async () => {
    const t = createTodo(repos, { title: "A" }, NOW);
    await notifyTodoCreated(repos, repos.todos.get(t.id) as never);
    repos.notifications.upsert({
      kind: "document.ready",
      subjectKind: "document",
      subjectId: "d1",
      title: "CV pronto",
      actionUrl: "/",
    });
    const all = repos.notifications.createdAfter(
      "1970-01-01T00:00:00.000Z",
      NATIVE_NOTIFICATION_KINDS,
      50,
    );
    expect(all.map((n) => n.kind)).toEqual(["todo.created"]);
    const last = all.at(-1)?.createdAt as string;
    expect(repos.notifications.createdAfter(last, NATIVE_NOTIFICATION_KINDS, 50)).toEqual([]);
  });
});
