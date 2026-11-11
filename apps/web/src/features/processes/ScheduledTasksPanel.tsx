import type { ScheduledRun, ScheduledTask } from "@narnia-jobs/shared";
import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import {
  useScheduledRun,
  useScheduledRuns,
  useScheduledTasks,
} from "../../hooks/useScheduledTasks";
import { type TKey, t } from "../../i18n";

/**
 * Processos › Tarefas agendadas (F14-12, plans/plan-v0/tasks/F14-leitura-de-emails.md §2.6): o que roda sozinho, de
 * quanto em quanto tempo, a última e a próxima execução, e o histórico com o log e o que cada execução tocou.
 */
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

const STATUS_TONE = { running: "info", done: "ok", error: "danger" } as const;

function RunStatus({ run }: { run: ScheduledRun }) {
  return (
    <Badge tone={STATUS_TONE[run.status]}>{t(`scheduled.status.${run.status}` as TKey)}</Badge>
  );
}

const countsText = (run: ScheduledRun) =>
  Object.entries(run.counts)
    .map(([k, n]) => `${n} ${t(`scheduled.counts.${k}` as TKey)}`)
    .join(" · ");

function RunDetail({ runId }: { runId: string }) {
  const { data } = useScheduledRun(runId);
  if (!data) return null;
  return (
    <section
      aria-label={t("scheduled.detail")}
      className="flex flex-col gap-3 rounded-md bg-muted/50 p-3"
    >
      {data.error ? <p className="text-sm text-danger">{data.error}</p> : null}
      <div>
        <h5 className="text-xs font-semibold uppercase text-muted-fg">{t("scheduled.log")}</h5>
        {data.log.length ? (
          <ul className="flex flex-col gap-1 font-mono text-xs">
            {data.log.map((l) => (
              <li
                key={l.id}
                className={
                  l.level === "error" ? "text-danger" : l.level === "warn" ? "text-warn" : ""
                }
              >
                <span className="text-muted-fg">{when(l.at)}</span> <span>{l.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-fg">{t("scheduled.noLog")}</p>
        )}
      </div>
      <div>
        <h5 className="text-xs font-semibold uppercase text-muted-fg">{t("scheduled.items")}</h5>
        {data.items.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {data.items.map((it) => (
              <li key={it.id} className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={
                    it.result === "error" ? "danger" : it.result === "skipped" ? "warn" : "neutral"
                  }
                >
                  {it.action}
                </Badge>
                {it.href ? (
                  <a href={it.href} className="underline">
                    {it.label}
                  </a>
                ) : (
                  <span>{it.label}</span>
                )}
                {it.detail ? <span className="text-xs text-muted-fg">{it.detail}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-fg">{t("scheduled.noItems")}</p>
        )}
      </div>
    </section>
  );
}

function RunHistory({ taskId }: { taskId: string }) {
  const { data: runs = [], isLoading } = useScheduledRuns(taskId, true);
  const [open, setOpen] = useState<string | null>(null);
  if (isLoading) return null;
  if (!runs.length) return <p className="text-sm text-muted-fg">{t("scheduled.noRuns")}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {runs.map((r) => (
        <li key={r.id} className="flex flex-col gap-2">
          <button
            type="button"
            className="flex flex-wrap items-center gap-2 text-left text-sm hover:underline"
            aria-expanded={open === r.id}
            onClick={() => setOpen(open === r.id ? null : r.id)}
          >
            <RunStatus run={r} />
            <span>{when(r.startedAt)}</span>
            <span className="text-muted-fg">{t(`scheduled.trigger.${r.trigger}` as TKey)}</span>
            {countsText(r) ? <span className="text-muted-fg">{countsText(r)}</span> : null}
          </button>
          {open === r.id ? <RunDetail runId={r.id} /> : null}
        </li>
      ))}
    </ul>
  );
}

function TaskCard({ task }: { task: ScheduledTask }) {
  const { patch, runNow } = useScheduledTasks();
  const [interval, setInterval] = useState(String(task.intervalMinutes));
  const [history, setHistory] = useState(false);
  useEffect(() => setInterval(String(task.intervalMinutes)), [task.intervalMinutes]);
  const n = Number(interval);
  const valid = Number.isInteger(n) && n >= task.minIntervalMinutes;
  const name = t(`scheduled.tasks.${task.id.replace(".", "_")}.name` as TKey);
  const inputId = `interval-${task.id}`;
  return (
    <Card role="region" aria-label={name} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{name}</h3>
          <p className="text-sm text-muted-fg">
            {t(`scheduled.tasks.${task.id.replace(".", "_")}.hint` as TKey)}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={task.running || runNow.isPending}
          onClick={() => runNow.mutate(task.id)}
        >
          {t("scheduled.runNow")}
        </Button>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted-fg">{t("scheduled.last")}</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {task.running ? (
            <Badge tone="info">{t("scheduled.status.running")}</Badge>
          ) : task.lastRun ? (
            <>
              <RunStatus run={task.lastRun} />
              <span>{when(task.lastRun.startedAt)}</span>
            </>
          ) : (
            t("scheduled.never")
          )}
        </dd>
        <dt className="text-muted-fg">{t("scheduled.next")}</dt>
        <dd>
          {task.paused
            ? t("scheduled.pausedShort")
            : task.nextRunAt
              ? when(task.nextRunAt)
              : t("scheduled.soon")}
        </dd>
      </dl>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={inputId} className="text-xs text-muted-fg">
            {t("scheduled.interval")}
          </label>
          <Input
            id={inputId}
            type="number"
            min={task.minIntervalMinutes}
            className="w-32"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!valid || n === task.intervalMinutes || patch.isPending}
          onClick={() => patch.mutate({ id: task.id, patch: { intervalMinutes: n } })}
        >
          {t("scheduled.saveInterval")}
        </Button>
        <div className="flex items-center gap-2">
          <Switch
            id={`paused-${task.id}`}
            checked={task.paused}
            onCheckedChange={(v) => patch.mutate({ id: task.id, patch: { paused: v } })}
            label={t("scheduled.paused")}
          />
          <label htmlFor={`paused-${task.id}`} className="text-sm">
            {t("scheduled.paused")}
          </label>
        </div>
      </div>
      {runNow.data && !runNow.data.enqueued ? (
        <p className="text-xs text-muted-fg">{t("scheduled.alreadyQueued")}</p>
      ) : null}
      {!valid ? (
        <p className="text-xs text-danger">
          {t("scheduled.minimum", { n: task.minIntervalMinutes })}
        </p>
      ) : null}
      <div>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={history}
          onClick={() => setHistory((h) => !h)}
        >
          {history ? t("scheduled.hideHistory") : t("scheduled.showHistory")}
        </Button>
        {history ? <RunHistory taskId={task.id} /> : null}
      </div>
    </Card>
  );
}

export function ScheduledTasksPanel() {
  const { tasks, isLoading } = useScheduledTasks();
  if (isLoading) return null;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-fg">{t("scheduled.hint")}</p>
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} />
      ))}
    </div>
  );
}
