import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * F14/M1 · tarefas agendadas na API (F14-12, §2.6): lista, intervalo e pausa (com o mínimo), "rodar agora" (enfileira
 * na fila `scheduled`), histórico de execuções e detalhe com log e itens.
 */
const json = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("F14/M1 · /api/scheduled-tasks", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("lista as tarefas com o intervalo padrão", async () => {
    t = makeTestApp();
    const r = (await (await t.api("/api/scheduled-tasks")).json()) as {
      tasks: Array<{ id: string; intervalMinutes: number; paused: boolean; lastRun: unknown }>;
    };
    expect(r.tasks.map((x) => x.id)).toEqual([
      "mail.sync",
      "postings.auto_analyze",
      "postings.feed_archive",
      "captures.prune",
      "job_applications.archive",
    ]);
    expect(r.tasks.find((x) => x.id === "captures.prune")).toMatchObject({
      intervalMinutes: 1440,
      paused: false,
      lastRun: null,
    });
  });

  it("PATCH muda intervalo e pausa; abaixo do mínimo dá 422; tarefa desconhecida 404", async () => {
    t = makeTestApp();
    const ok = await t.api(
      "/api/scheduled-tasks/captures.prune",
      json("PATCH", { intervalMinutes: 120, paused: true }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      id: "captures.prune",
      intervalMinutes: 120,
      paused: true,
    });
    const low = await t.api(
      "/api/scheduled-tasks/captures.prune",
      json("PATCH", { intervalMinutes: 5 }),
    );
    expect(low.status).toBe(422);
    expect(((await low.json()) as { error: { code: string } }).error.code).toBe(
      "interval_too_short",
    );
    expect((await t.api("/api/scheduled-tasks/nope", json("PATCH", { paused: true }))).status).toBe(
      404,
    );
    expect((await t.api("/api/scheduled-tasks/captures.prune", json("PATCH", {}))).status).toBe(
      400,
    );
  });

  it("rodar agora enfileira scheduled.run manual na fila scheduled", async () => {
    t = makeTestApp();
    const r = await t.api("/api/scheduled-tasks/job_applications.archive/run", { method: "POST" });
    expect(r.status).toBe(202);
    expect(((await r.json()) as { enqueued: boolean }).enqueued).toBe(true);
    const again = await t.api("/api/scheduled-tasks/job_applications.archive/run", {
      method: "POST",
    });
    expect(((await again.json()) as { enqueued: boolean }).enqueued).toBe(false);
    expect(t.queue.tasks.at(-1)).toEqual({
      queue: "scheduled",
      type: "scheduled.run",
      key: "job_applications.archive",
      payload: { taskId: "job_applications.archive", trigger: "manual" },
    });
    expect((await t.api("/api/scheduled-tasks/nope/run", { method: "POST" })).status).toBe(404);
  });

  it("histórico e detalhe da execução com log e itens", async () => {
    t = makeTestApp();
    const at = "2026-11-11T12:00:00.000Z";
    const runId = t.repos.scheduled.startRun({ taskId: "captures.prune", trigger: "manual", at });
    t.repos.scheduled.log(runId, "info", "1 captura apagada", at);
    t.repos.scheduled.item(runId, {
      at,
      kind: "capture",
      refId: "c1",
      label: "c1",
      action: "apagada",
      result: "ok",
      detail: null,
      href: null,
    });
    t.repos.scheduled.finishRun(runId, { status: "done", counts: { deleted: 1 }, error: null, at });
    const list = (await (await t.api("/api/scheduled-tasks/captures.prune/runs")).json()) as {
      runs: Array<{ id: string; itemCount: number; counts: Record<string, number> }>;
    };
    expect(list.runs).toHaveLength(1);
    expect(list.runs[0]).toMatchObject({ id: runId, itemCount: 1, counts: { deleted: 1 } });
    const detail = (await (await t.api(`/api/scheduled-runs/${runId}`)).json()) as {
      log: Array<{ message: string }>;
      items: Array<{ refId: string }>;
    };
    expect(detail.log.map((l) => l.message)).toEqual(["1 captura apagada"]);
    expect(detail.items.map((i) => i.refId)).toEqual(["c1"]);
    expect((await t.api("/api/scheduled-runs/nope")).status).toBe(404);
  });

  it("desfazer e refazer a leitura de e-mails: devolve o resumo e já pede uma leitura nova; outra tarefa ou execução inexistente recusa", async () => {
    t = makeTestApp();
    const at = "2026-11-11T12:00:00.000Z";
    const mailRun = t.repos.scheduled.startRun({ taskId: "mail.sync", trigger: "manual", at });
    t.repos.scheduled.finishRun(mailRun, { status: "done", counts: {}, error: null, at });
    const r = await t.api("/api/mail/redo", json("POST", { runId: mailRun }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ mails: 0, kept: [], enqueued: true });
    expect(t.queue.tasks.at(-1)).toMatchObject({
      key: "mail.sync",
      payload: { trigger: "manual" },
    });
    const other = t.repos.scheduled.startRun({ taskId: "captures.prune", trigger: "manual", at });
    t.repos.scheduled.finishRun(other, { status: "done", counts: {}, error: null, at });
    expect((await t.api("/api/mail/redo", json("POST", { runId: other }))).status).toBe(422);
    expect((await t.api("/api/mail/redo", json("POST", { runId: "nao-existe" }))).status).toBe(404);
  });
});
