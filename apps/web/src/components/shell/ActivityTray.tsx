import type { Job } from "@narnia-jobs/shared";
import { Activity } from "lucide-react";
import { useState } from "react";
import { useJobs } from "../../hooks/useJobs";
import { type TKey, t } from "../../i18n";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";

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

export function ActivityTray({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const { jobs, activeCount, cancel, retry } = useJobs();
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
          {jobs.length === 0 ? (
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
