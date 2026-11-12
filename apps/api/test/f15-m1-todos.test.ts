import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/** F15/M1 · tarefas na API: listar com filtros e tags, criar, editar, mover, apagar; cada mudança avisa as abas. */
const req = (method: string, body?: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

describe("F15/M1 · /api/todos", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("cria, lista com filtros e tags, edita, move e apaga", async () => {
    t = makeTestApp();
    const r = await t.api(
      "/api/todos",
      req("POST", { title: "Fazer a triagem", tags: ["Acme"], dueAt: "2026-01-01T12:00:00.000Z" }),
    );
    expect(r.status).toBe(201);
    const a = (await r.json()) as { id: string; tags: string[]; status: string };
    expect(a).toMatchObject({ tags: ["acme"], status: "todo" });
    await t.api("/api/todos", req("POST", { title: "Outra", tags: ["pessoal"] }));
    expect(t.events.some((e) => e.type === "todo.updated")).toBe(true);

    const list = async (qs = "") =>
      (await (await t.api(`/api/todos${qs}`)).json()) as {
        todos: Array<{ title: string; status: string }>;
        tags: Array<{ tag: string; count: number }>;
      };
    expect((await list()).todos).toHaveLength(2);
    expect((await list()).tags.map((x) => x.tag).sort()).toEqual(["acme", "pessoal"]);
    expect((await list("?tag=acme")).todos.map((x) => x.title)).toEqual(["Fazer a triagem"]);
    expect((await list("?overdue=1")).todos.map((x) => x.title)).toEqual(["Fazer a triagem"]);
    expect((await list("?source=email")).todos).toHaveLength(0);

    const p = await t.api(`/api/todos/${a.id}`, req("PATCH", { title: "Triagem pelo WhatsApp" }));
    expect(((await p.json()) as { title: string }).title).toBe("Triagem pelo WhatsApp");
    const m = await t.api(`/api/todos/${a.id}/move`, req("POST", { status: "done" }));
    expect(((await m.json()) as { status: string; doneAt: string | null }).doneAt).not.toBeNull();

    expect((await t.api(`/api/todos/${a.id}`, req("DELETE"))).status).toBe(204);
    expect((await t.api(`/api/todos/${a.id}`, req("DELETE"))).status).toBe(404);
  });

  it("recusa título vazio, link que não é http e candidatura inexistente", async () => {
    t = makeTestApp();
    expect((await t.api("/api/todos", req("POST", { title: " " }))).status).toBe(400);
    expect(
      (await t.api("/api/todos", req("POST", { title: "x", actionUrl: "javascript:alert(1)" })))
        .status,
    ).toBe(400);
    expect(
      (await t.api("/api/todos", req("POST", { title: "x", applicationId: "nao" }))).status,
    ).toBe(404);
    expect((await t.api("/api/todos/nao/move", req("POST", { status: "doing" }))).status).toBe(404);
  });
});
