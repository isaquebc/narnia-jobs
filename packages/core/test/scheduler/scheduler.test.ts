import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WsEvent } from "@narnia-jobs/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRepos,
  dueScheduledTasks,
  listScheduledTasks,
  migrate,
  openDatabase,
  type Repos,
  runScheduledTask,
  SCHEDULED_TASK_HANDLERS,
  SCHEDULED_TASKS,
  ScheduledTaskError,
  updateScheduledTask,
} from "../../src";

/**
 * F14/M1 · agendador (F14-12, §2.6): definições no código, escolha da pessoa e histórico no banco, execução com log e
 * itens, próxima execução e retenção. RT-I1: as rotinas diárias de hoje (poda das capturas, arquivamento das
 * candidaturas) dão o mesmo resultado rodando pelo agendador, e agora avisam a web (defeito 2 de §2.0.4).
 */
const T0 = new Date("2026-11-11T12:00:00.000Z");
const plus = (min: number, from = T0) => new Date(from.getTime() + min * 60_000);

describe("F14/M1 · agendador", () => {
  let repos: Repos;
  let dataDir: string;
  let events: WsEvent[];
  const publish = async (e: WsEvent) => {
    events.push(e);
  };
  beforeEach(() => {
    const db = openDatabase(":memory:");
    migrate(db);
    repos = createRepos(db);
    dataDir = mkdtempSync(join(tmpdir(), "narnia-sched-"));
    events = [];
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  const run = (
    taskId: keyof typeof SCHEDULED_TASKS,
    now = T0,
    trigger: "schedule" | "manual" = "schedule",
  ) => runScheduledTask({ repos, dataDir, taskId, trigger, now, publish });

  it("lista as tarefas com o intervalo padrão, sem execução e devidas no primeiro boot", () => {
    const tasks = listScheduledTasks(repos);
    expect(tasks.map((t) => t.id)).toEqual([
      "mail.sync",
      "captures.prune",
      "job_applications.archive",
    ]);
    const prune = tasks[1];
    expect(prune?.intervalMinutes).toBe(SCHEDULED_TASKS["captures.prune"].defaultIntervalMinutes);
    expect(prune?.paused).toBe(false);
    expect(prune?.lastRun).toBeNull();
    expect(prune?.nextRunAt).toBeNull();
    expect(dueScheduledTasks(repos, T0)).toEqual([
      "mail.sync",
      "captures.prune",
      "job_applications.archive",
    ]);
  });

  it("execução grava início, fim, contadores e a próxima execução (início + intervalo); não fica devida antes disso", async () => {
    const r = await run("captures.prune");
    expect(r.status).toBe("done");
    const task = listScheduledTasks(repos).find((t) => t.id === "captures.prune");
    expect(task?.lastRun?.id).toBe(r.id);
    expect(task?.lastRun?.trigger).toBe("schedule");
    expect(task?.nextRunAt).toBe(plus(24 * 60).toISOString());
    expect(dueScheduledTasks(repos, plus(60))).toEqual(["mail.sync", "job_applications.archive"]);
    expect(dueScheduledTasks(repos, plus(24 * 60))).toContain("captures.prune");
    expect(
      events
        .filter((e) => e.type === "scheduled_run.updated")
        .map((e) => (e as { status: string }).status),
    ).toEqual(["running", "done"]);
  });

  it("intervalo: respeita o mínimo, muda a próxima execução; pausada não fica devida", () => {
    expect(() => updateScheduledTask(repos, "captures.prune", { intervalMinutes: 0 }, T0)).toThrow(
      ScheduledTaskError,
    );
    const min = SCHEDULED_TASKS["captures.prune"].minIntervalMinutes;
    expect(() =>
      updateScheduledTask(repos, "captures.prune", { intervalMinutes: min - 1 }, T0),
    ).toThrow(/mínimo/);
    const t = updateScheduledTask(
      repos,
      "captures.prune",
      { intervalMinutes: min, paused: true },
      T0,
    );
    expect(t.intervalMinutes).toBe(min);
    expect(t.paused).toBe(true);
    expect(dueScheduledTasks(repos, T0)).toEqual(["mail.sync", "job_applications.archive"]);
    updateScheduledTask(repos, "captures.prune", { paused: false }, T0);
    expect(dueScheduledTasks(repos, T0)).toContain("captures.prune");
  });

  it("erro do handler: execução em erro com a mensagem no log; a próxima execução continua marcada", async () => {
    const original = SCHEDULED_TASK_HANDLERS["captures.prune"];
    SCHEDULED_TASK_HANDLERS["captures.prune"] = async (ctx) => {
      ctx.log("info", "começou");
      throw new Error("disco cheio");
    };
    try {
      const r = await run("captures.prune");
      expect(r.status).toBe("error");
      const detail = repos.scheduled.run(r.id);
      expect(detail?.error).toBe("disco cheio");
      expect(detail?.log.map((l) => [l.level, l.message])).toEqual([
        ["info", "começou"],
        ["error", "disco cheio"],
      ]);
      expect(listScheduledTasks(repos).find((t) => t.id === "captures.prune")?.nextRunAt).toBe(
        plus(24 * 60).toISOString(),
      );
    } finally {
      SCHEDULED_TASK_HANDLERS["captures.prune"] = original;
    }
  });

  it("execução manual não espera a hora; com uma execução em andamento, nada fica devido nem roda de novo", async () => {
    const id = repos.scheduled.startRun({
      taskId: "captures.prune",
      trigger: "schedule",
      at: T0.toISOString(),
    });
    expect(listScheduledTasks(repos).find((t) => t.id === "captures.prune")?.running).toBe(true);
    expect(dueScheduledTasks(repos, T0)).toEqual(["mail.sync", "job_applications.archive"]);
    const again = await run("captures.prune", T0, "manual");
    expect(again.skipped).toBe(true);
    repos.scheduled.finishRun(id, {
      status: "done",
      counts: {},
      error: null,
      at: T0.toISOString(),
    });
    const manual = await run("captures.prune", plus(5), "manual");
    expect(manual.status).toBe("done");
    expect(repos.scheduled.run(manual.id)?.trigger).toBe("manual");
  });

  it("execuções presas em 'running' (worker reiniciou) viram erro", () => {
    const id = repos.scheduled.startRun({
      taskId: "captures.prune",
      trigger: "schedule",
      at: T0.toISOString(),
    });
    expect(repos.scheduled.failRunning("interrompida", plus(1).toISOString())).toEqual([id]);
    expect(repos.scheduled.run(id)?.status).toBe("error");
    expect(listScheduledTasks(repos).find((t) => t.id === "captures.prune")?.running).toBe(false);
  });

  it("retenção: execuções mais antigas que 90 dias saem com o log e os itens", async () => {
    const old = await run("captures.prune", plus(-91 * 24 * 60));
    await run("captures.prune", T0);
    expect(repos.scheduled.run(old.id)).toBeNull();
    expect(repos.scheduled.runs("captures.prune", 10)).toHaveLength(1);
  });

  it("RT-I1 · poda das capturas: mesmo resultado de antes (some a captura velha e o HTML), com item por captura", async () => {
    const old = repos.extension.createCapture(
      {
        kind: "page",
        url: "https://vagas.example/1",
        title: "Vaga",
        payload: { ok: true } as never,
        deviceId: null,
      },
      plus(-31 * 24 * 60),
    );
    mkdirSync(join(dataDir, "captures"), { recursive: true });
    writeFileSync(join(dataDir, "captures", `${old.id}.html`), "<html></html>");
    const r = await run("captures.prune");
    expect(r.status).toBe("done");
    expect(existsSync(join(dataDir, "captures", `${old.id}.html`))).toBe(false);
    const detail = repos.scheduled.run(r.id);
    expect(detail?.counts).toEqual({ deleted: 1 });
    expect(detail?.items.map((i) => [i.kind, i.refId, i.result])).toEqual([
      ["capture", old.id, "ok"],
    ]);
  });

  it("RT-I1 + defeito 2 · arquivamento das candidaturas: arquiva as inativas e avisa a web por candidatura", async () => {
    const ids = ["a1", "a2"];
    const archive = repos.jobApplications.archiveInactive;
    repos.jobApplications.archiveInactive = () => ids;
    try {
      const r = await run("job_applications.archive");
      expect(r.status).toBe("done");
      expect(repos.scheduled.run(r.id)?.counts).toEqual({ archived: 2 });
      expect(events.filter((e) => e.type === "job_application.updated")).toEqual([
        { type: "job_application.updated", applicationId: "a1" },
        { type: "job_application.updated", applicationId: "a2" },
      ]);
      expect(repos.scheduled.run(r.id)?.items.map((i) => i.href)).toEqual([
        "/candidaturas/a1",
        "/candidaturas/a2",
      ]);
    } finally {
      repos.jobApplications.archiveInactive = archive;
    }
  });
});

describe("F14/M1 · intervalo depois de uma execução", () => {
  it("o intervalo novo conta do início da última execução", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    await runScheduledTask({
      repos,
      dataDir: tmpdir(),
      taskId: "captures.prune",
      trigger: "schedule",
      now: T0,
      publish: async () => {},
    });
    const t = updateScheduledTask(repos, "captures.prune", { intervalMinutes: 120 }, plus(10));
    expect(t.nextRunAt).toBe(plus(120).toISOString());
  });
});

describe("F14/M1 · revisão: a execução sempre fecha", () => {
  it("falha do aviso à web (Redis) não deixa a execução em running", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const r = await runScheduledTask({
      repos,
      dataDir: tmpdir(),
      taskId: "captures.prune",
      trigger: "schedule",
      now: T0,
      publish: async () => {
        throw new Error("redis fora do ar");
      },
    });
    expect(r.status).toBe("done");
    expect(repos.scheduled.isRunning("captures.prune")).toBe(false);
  });
});
