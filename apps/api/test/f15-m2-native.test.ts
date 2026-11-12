import { notifyTodoCreated } from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * F15/M2 · vigia do sistema: `/api/notifications/native` devolve os avisos novos depois do cursor, só dos tipos que
 * viram notificação nativa; sem cursor, só o cursor (nada do histórico). Feita ou apagada, a tarefa resolve os avisos.
 */
const req = (method: string, body?: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
type Native = {
  cursor: string;
  items: Array<{ kind: string; title: string; url: string; urgent: boolean }>;
};

describe("F15/M2 · avisos nativos", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("primeira vez só o cursor; depois, os avisos novos dos tipos do vigia, uma vez", async () => {
    t = makeTestApp();
    const first = (await (await t.api("/api/notifications/native")).json()) as Native;
    expect(first.items).toEqual([]);
    const cursor = new Date(Date.parse(first.cursor) - 1000).toISOString();

    const created = (await (
      await t.api("/api/todos", req("POST", { title: "Fazer a triagem" }))
    ).json()) as { id: string };
    await notifyTodoCreated(t.repos, t.repos.todos.get(created.id) as never);
    t.repos.notifications.upsert({
      kind: "document.ready",
      subjectKind: "document",
      subjectId: "d1",
      title: "CV pronto",
      actionUrl: "/",
    });
    const next = (await (
      await t.api(`/api/notifications/native?after=${encodeURIComponent(cursor)}`)
    ).json()) as Native;
    expect(next.items).toEqual([
      {
        id: expect.any(String),
        kind: "todo.created",
        title: "Nova tarefa: Fazer a triagem",
        body: null,
        url: `/tarefas?id=${created.id}`,
        urgent: false,
      },
    ]);
    const again = (await (
      await t.api(`/api/notifications/native?after=${encodeURIComponent(next.cursor)}`)
    ).json()) as Native;
    expect(again.items).toEqual([]);

    // formato texto (o vigia em bash): cursor na 1ª linha; campos por tabulação, sem quebras dentro deles
    const text = await (
      await t.api(`/api/notifications/native?format=text&after=${encodeURIComponent(cursor)}`)
    ).text();
    expect(text).toBe(
      `${next.cursor}\nNova tarefa: Fazer a triagem\t\t/tarefas?id=${created.id}\tfalse\n`,
    );
    expect(
      /^\d{4}-/.test(await (await t.api("/api/notifications/native?format=text")).text()),
    ).toBe(true);

    // feita: o aviso sai da bandeja
    await t.api(`/api/todos/${created.id}/move`, req("POST", { status: "done" }));
    expect(t.repos.notifications.list().some((n) => n.kind === "todo.created")).toBe(false);
  });
});
