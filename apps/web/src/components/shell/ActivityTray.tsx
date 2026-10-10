import type { Job, RunStatus } from "@narnia-jobs/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { useEffect, useState } from "react";
import { useApi, useWs } from "../../app/context";
import { useJobs } from "../../hooks/useJobs";
import { type TKey, t } from "../../i18n";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import { NavLink } from "./NavLink";

const STAGE_ORDER = [
  "ingest.read_text",
  "ocr.pages",
  "extract.read_doc",
  "ingest.consolidate",
  "extract.facts",
  "extract.digest",
  "ingest.reconcile",
  "ingest.review_check",
];
/** Etapas fora da cadeia de arquivos (tarefas genéricas, F02/F03) e o estado `stalled` do worker. */
const OTHER_STAGES = [
  "ingest.github.prepare",
  "ingest.github.pick",
  "ingest.github.repo",
  "ingest.github.synthesis",
  "profile.analyze",
  "stalled",
];

export function stageLabel(stage: string): string {
  if (!STAGE_ORDER.includes(stage) && !OTHER_STAGES.includes(stage)) return stage;
  return t(`stages.${stage.replaceAll(".", "_")}` as TKey);
}

export function stageIndex(stage: string): number {
  return STAGE_ORDER.indexOf(stage);
}

export function statusTone(status: Job["status"]): "neutral" | "ok" | "warn" | "danger" | "info" {
  switch (status) {
    case "done":
      return "ok";
    case "error":
      return "danger";
    case "stalled":
      return "warn";
    case "active":
      return "info";
    default:
      return "neutral";
  }
}

export function JobRow({
  job,
  onCancel,
  onRetry,
}: {
  job: Job;
  onCancel?: (id: string) => void;
  onRetry?: (id: string) => void;
}) {
  const canCancel = job.status === "queued" || job.status === "active" || job.status === "stalled";
  const canRetry = job.status === "error" || job.status === "cancelled";
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{stageLabel(job.stage)}</span>
        <Badge tone={statusTone(job.status)}>{t(`activity.status.${job.status}` as TKey)}</Badge>
      </div>
      {canCancel ? <Progress value={job.progress} label={stageLabel(job.stage)} /> : null}
      {job.error ? <p className="text-xs text-danger">{job.error}</p> : null}
      <div className="flex gap-2">
        {canCancel && onCancel ? (
          <Button variant="outline" size="sm" onClick={() => onCancel(job.id)}>
            {t("activity.cancel")}
          </Button>
        ) : null}
        {canRetry && onRetry ? (
          <Button variant="outline" size="sm" onClick={() => onRetry(job.id)}>
            {t("activity.retry")}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** Execuções que esperam o usuário (correções F03, item 16): aparecem na bandeja com "abrir". */
export const STOPPED_STATUSES: RunStatus[] = [
  "awaiting_confirmation",
  "awaiting_decision",
  "paused",
];

function useStoppedRuns() {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const runs = useQuery({
    queryKey: ["ingestions", "stopped"],
    queryFn: () => api.listIngestions({ status: STOPPED_STATUSES }),
  });
  useEffect(() => {
    ws.connect();
    return ws.subscribe((event) => {
      if (event.type === "ingestion.updated")
        void qc.invalidateQueries({ queryKey: ["ingestions", "stopped"] });
    });
  }, [ws, qc]);
  return runs.data?.runs ?? [];
}

export function ActivityTray({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const { jobs, activeCount, cancel, retry } = useJobs();
  const stopped = useStoppedRuns();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-label={t("activity.title")}
        onClick={() => setOpen((o) => !o)}
      >
        <Activity size={16} />
        <span data-testid="activity-count" className="text-xs">
          {activeCount}
        </span>
      </Button>
      {open ? (
        <section
          aria-label={t("activity.title")}
          className="absolute right-0 z-30 mt-2 w-96 rounded-lg border border-border bg-card p-3 shadow-lg"
        >
          <h3 className="mb-2 text-sm font-semibold">{t("activity.title")}</h3>
          {stopped.length > 0 ? (
            <ul aria-label={t("activity.stopped")} className="mb-2 flex flex-col gap-2">
              {stopped.map((run) => {
                const label = t(`run.status.${run.status}` as TKey);
                return (
                  <li
                    key={run.id}
                    aria-label={label}
                    className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm"
                  >
                    <Badge tone="warn">{label}</Badge>
                    <NavLink
                      to={`/ingestao/${run.id}`}
                      className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
                    >
                      {t("activity.open")}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {jobs.length === 0 && stopped.length === 0 ? (
            <p className="text-sm text-muted-fg">{t("activity.empty")}</p>
          ) : (
            <ul className="flex max-h-96 flex-col gap-2 overflow-auto">
              {jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  onCancel={(id) => cancel.mutate(id)}
                  onRetry={(id) => retry.mutate(id)}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
