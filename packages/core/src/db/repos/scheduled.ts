import type {
  ScheduledRun,
  ScheduledRunDetail,
  ScheduledRunItem,
  ScheduledTaskId,
} from "@narnia-jobs/shared";
import { newId } from "../../ids";
import type { Db } from "../open";

/** Estado guardado de uma tarefa agendada (F14-12): só o que a pessoa escolheu e a próxima execução. */
export interface ScheduledTaskState {
  intervalMinutes: number | null;
  paused: boolean;
  nextRunAt: string | null;
}

export interface ScheduledRepo {
  task(id: ScheduledTaskId): ScheduledTaskState;
  setTask(id: ScheduledTaskId, patch: Partial<ScheduledTaskState>, at: string): ScheduledTaskState;
  startRun(input: {
    taskId: ScheduledTaskId;
    trigger: ScheduledRun["trigger"];
    at: string;
  }): string;
  log(runId: string, level: "info" | "warn" | "error", message: string, at: string): void;
  item(runId: string, item: Omit<ScheduledRunItem, "at" | "id"> & { at: string }): void;
  finishRun(
    runId: string,
    out: {
      status: "done" | "error";
      counts: Record<string, number>;
      error: string | null;
      at: string;
    },
  ): void;
  runs(taskId: ScheduledTaskId, limit: number): ScheduledRun[];
  run(id: string): ScheduledRunDetail | null;
  lastRun(taskId: ScheduledTaskId): ScheduledRun | null;
  isRunning(taskId: ScheduledTaskId): boolean;
  /** Execuções presas em `running` (o worker caiu no meio) viram erro; devolve os ids. */
  failRunning(error: string, at: string, taskId?: ScheduledTaskId): string[];
  /** Apaga as execuções que começaram antes de `before` (com log e itens); devolve quantas. */
  pruneRuns(before: string): number;
}

interface RunRow {
  id: string;
  task_id: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  counts_json: string;
  error: string | null;
  item_count: number;
}

const RUN_SELECT = `select r.*, (select count(*) from scheduled_run_item i where i.run_id = r.id) as item_count
  from scheduled_run r`;

function mapRun(r: RunRow): ScheduledRun {
  return {
    id: r.id,
    taskId: r.task_id as ScheduledTaskId,
    trigger: r.trigger as ScheduledRun["trigger"],
    status: r.status as ScheduledRun["status"],
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    counts: JSON.parse(r.counts_json) as Record<string, number>,
    error: r.error,
    itemCount: Number(r.item_count),
  };
}

export function scheduledRepo(db: Db): ScheduledRepo {
  const q = (sql: string) => db.prepare(sql);
  const task = (id: ScheduledTaskId): ScheduledTaskState => {
    const r = q("select * from scheduled_task where id = ?").get(id) as
      | { interval_minutes: number | null; paused: number; next_run_at: string | null }
      | undefined;
    return {
      intervalMinutes: r?.interval_minutes ?? null,
      paused: r?.paused === 1,
      nextRunAt: r?.next_run_at ?? null,
    };
  };
  const run = (id: string): ScheduledRunDetail | null => {
    const r = q(`${RUN_SELECT} where r.id = ?`).get(id) as unknown as RunRow | undefined;
    if (!r) return null;
    const log = q(
      "select id, at, level, message from scheduled_run_log where run_id = ? order by id",
    ).all(id) as Array<{
      id: number;
      at: string;
      level: "info" | "warn" | "error";
      message: string;
    }>;
    const items = (
      q(
        "select id, at, kind, ref_id, label, action, result, detail, href from scheduled_run_item where run_id = ? order by id",
      ).all(id) as Array<{
        id: number;
        at: string;
        kind: string;
        ref_id: string | null;
        label: string;
        action: string;
        result: ScheduledRunItem["result"];
        detail: string | null;
        href: string | null;
      }>
    ).map((i) => ({
      id: i.id,
      at: i.at,
      kind: i.kind,
      refId: i.ref_id,
      label: i.label,
      action: i.action,
      result: i.result,
      detail: i.detail,
      href: i.href,
    }));
    return { ...mapRun(r), log, items };
  };
  return {
    task,
    setTask(id, patch, at) {
      const cur = task(id);
      const next = { ...cur, ...patch };
      q(
        `insert into scheduled_task (id, interval_minutes, paused, next_run_at, updated_at) values (?, ?, ?, ?, ?)
         on conflict (id) do update set interval_minutes = excluded.interval_minutes, paused = excluded.paused,
           next_run_at = excluded.next_run_at, updated_at = excluded.updated_at`,
      ).run(id, next.intervalMinutes, next.paused ? 1 : 0, next.nextRunAt, at);
      return next;
    },
    startRun({ taskId, trigger, at }) {
      const id = newId();
      q(
        "insert into scheduled_run (id, task_id, trigger, status, started_at) values (?, ?, ?, 'running', ?)",
      ).run(id, taskId, trigger, at);
      return id;
    },
    log(runId, level, message, at) {
      q("insert into scheduled_run_log (run_id, at, level, message) values (?, ?, ?, ?)").run(
        runId,
        at,
        level,
        message,
      );
    },
    item(runId, i) {
      q(
        `insert into scheduled_run_item (run_id, at, kind, ref_id, label, action, result, detail, href)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(runId, i.at, i.kind, i.refId, i.label, i.action, i.result, i.detail, i.href);
    },
    finishRun(runId, out) {
      q(
        "update scheduled_run set status = ?, counts_json = ?, error = ?, finished_at = ? where id = ?",
      ).run(out.status, JSON.stringify(out.counts), out.error, out.at, runId);
    },
    runs(taskId, limit) {
      return (
        q(`${RUN_SELECT} where r.task_id = ? order by r.started_at desc, r.rowid desc limit ?`).all(
          taskId,
          limit,
        ) as unknown as RunRow[]
      ).map(mapRun);
    },
    run,
    lastRun(taskId) {
      const r = q(
        `${RUN_SELECT} where r.task_id = ? order by r.started_at desc, r.rowid desc limit 1`,
      ).get(taskId) as unknown as RunRow | undefined;
      return r ? mapRun(r) : null;
    },
    isRunning(taskId) {
      return !!q(
        "select 1 from scheduled_run where task_id = ? and status = 'running' limit 1",
      ).get(taskId);
    },
    failRunning(error, at, taskId) {
      const ids = (
        (taskId
          ? q("select id from scheduled_run where status = 'running' and task_id = ?").all(taskId)
          : q("select id from scheduled_run where status = 'running'").all()) as Array<{
          id: string;
        }>
      ).map((r) => r.id);
      for (const id of ids) {
        q("update scheduled_run set status = 'error', error = ?, finished_at = ? where id = ?").run(
          error,
          at,
          id,
        );
        q(
          "insert into scheduled_run_log (run_id, at, level, message) values (?, ?, 'error', ?)",
        ).run(id, at, error);
      }
      return ids;
    },
    pruneRuns(before) {
      return Number(
        q("delete from scheduled_run where started_at < ? and status != 'running'").run(before)
          .changes,
      );
    },
  };
}
