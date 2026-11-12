import { beforeEach, describe, expect, it } from "vitest";
import {
  createRepos,
  createTodo,
  listTodos,
  migrate,
  moveTodo,
  openDatabase,
  type Repos,
  removeTodo,
  TodoError,
  updateTodo,
} from "../../src";
import { DEFAULT_STAGES } from "../../src/job-applications";

/** F15/M1 · tarefas: criar, tags, filtros, mover no kanban, ligar à candidatura. */
const NOW = new Date("2026-11-12T12:00:00.000Z");

describe("F15/M1 · tarefas", () => {
  let repos: Repos;
  let appId: string;
  beforeEach(() => {
    const db = openDatabase(":memory:");
    migrate(db);
    repos = createRepos(db);
    const p = repos.postings.create({ company: "Acme", title: "Dev Backend" } as never, {
      source: "user",
    });
    appId = repos.jobApplications.create({
      postingId: p.id,
      profileId: null,
      cvVersionId: null,
      coverLetterVersionId: null,
      appliedOn: "2026-11-01",
      stages: [...DEFAULT_STAGES],
    }).id;
  });

  it("cria manual no topo de A fazer, com tags normalizadas e a candidatura (empresa e cargo)", () => {
    createTodo(repos, { title: "Primeira" }, NOW);
    const t = createTodo(
      repos,
      {
        title: " Estudar system design ",
        tags: ["Estudo", "estudo ", "Acme"],
        applicationId: appId,
      },
      NOW,
    );
    expect(t).toMatchObject({
      title: "Estudar system design",
      status: "todo",
      source: "manual",
      tags: ["acme", "estudo"],
      application: { id: appId, company: "Acme", title: "Dev Backend" },
    });
    expect(listTodos(repos, {}, NOW).todos.map((x) => x.title)).toEqual([
      "Estudar system design",
      "Primeira",
    ]);
    expect(() => createTodo(repos, { title: "x", applicationId: "nao" }, NOW)).toThrow(TodoError);
  });

  it("filtra por tag, origem, candidatura, texto e só as vencidas; lista as tags com contagem", () => {
    createTodo(repos, { title: "Triagem Acme", tags: ["acme"], applicationId: appId }, NOW);
    createTodo(
      repos,
      { title: "Teste vencido", tags: ["acme", "teste"], dueAt: "2026-11-11T12:00:00.000Z" },
      NOW,
    );
    createTodo(repos, { title: "Comprar café", dueAt: "2026-11-20T12:00:00.000Z" }, NOW);
    const titles = (f: Parameters<typeof listTodos>[1]) =>
      listTodos(repos, f, NOW)
        .todos.map((x) => x.title)
        .sort();
    expect(titles({ tag: "ACME" })).toEqual(["Teste vencido", "Triagem Acme"]);
    expect(titles({ applicationId: appId })).toEqual(["Triagem Acme"]);
    expect(titles({ overdue: true })).toEqual(["Teste vencido"]);
    expect(titles({ q: "café" })).toEqual(["Comprar café"]);
    expect(titles({ q: "teste" })).toEqual(["Teste vencido"]);
    expect(titles({ source: "email" })).toEqual([]);
    expect(listTodos(repos, {}, NOW).tags).toEqual([
      { tag: "acme", count: 2 },
      { tag: "teste", count: 1 },
    ]);
  });

  it("move entre colunas e reordena; Feito marca a data e voltar desmarca", () => {
    const a = createTodo(repos, { title: "A" }, NOW);
    const b = createTodo(repos, { title: "B" }, NOW);
    const c = createTodo(repos, { title: "C" }, NOW);
    const col = (s: string) =>
      listTodos(repos, {}, NOW)
        .todos.filter((x) => x.status === s)
        .map((x) => x.title);
    expect(col("todo")).toEqual(["C", "B", "A"]);
    moveTodo(repos, a.id, { status: "todo", index: 0 }, NOW);
    expect(col("todo")).toEqual(["A", "C", "B"]);
    const done = moveTodo(repos, b.id, { status: "done" }, NOW);
    expect(done.doneAt).toBe(NOW.toISOString());
    moveTodo(repos, c.id, { status: "done", index: 0 }, NOW);
    expect(col("done")).toEqual(["C", "B"]);
    expect(col("todo")).toEqual(["A"]);
    expect(moveTodo(repos, b.id, { status: "doing" }, NOW).doneAt).toBeNull();
    expect(() => moveTodo(repos, "nao", { status: "done" }, NOW)).toThrow(TodoError);
  });

  it("edita (prazo novo zera os avisos), solta a candidatura e apaga; apagar a candidatura só solta a tarefa", () => {
    const t = createTodo(
      repos,
      { title: "Teste", dueAt: "2026-11-13T12:00:00.000Z", applicationId: appId },
      NOW,
    );
    repos.todos.markNotified(t.id, "due_soon", NOW.toISOString());
    const u = updateTodo(
      repos,
      t.id,
      { dueAt: "2026-11-14T12:00:00.000Z", tags: ["x"], note: " nota " },
      NOW,
    );
    expect(u).toMatchObject({ dueAt: "2026-11-14T12:00:00.000Z", tags: ["x"], note: "nota" });
    expect(repos.todos.get(t.id)?.notifiedDueSoonAt).toBeNull();
    expect(updateTodo(repos, t.id, { applicationId: null }, NOW).application).toBeNull();
    updateTodo(repos, t.id, { applicationId: appId }, NOW);
    repos.db.prepare("delete from job_application where id = ?").run(appId);
    expect(repos.todos.get(t.id)?.applicationId).toBeNull();
    removeTodo(repos, t.id);
    expect(repos.todos.get(t.id)).toBeNull();
    expect(() => removeTodo(repos, t.id)).toThrow(TodoError);
  });
});
