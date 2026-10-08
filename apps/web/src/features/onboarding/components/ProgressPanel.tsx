import type { Job } from "@narnia-jobs/shared";
import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { stageIndex, stageLabel } from "../../../components/shell/ActivityTray";
import { Alert } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Progress } from "../../../components/ui/progress";
import { t } from "../../../i18n";

export function ProgressPanel({
  status,
  jobs,
  onRetryJob,
  onSkip,
  onContinue,
}: {
  status: string;
  jobs: Job[];
  onRetryJob: (jobId: string) => void;
  onSkip: () => void;
  onContinue: () => void;
}) {
  const ordered = jobs.slice().sort((a, b) => stageIndex(a.stage) - stageIndex(b.stage));
  const total = ordered.length;
  const doneCount = ordered.filter((j) => j.status === "done").length;
  const current = ordered.find((j) => j.status !== "done") ?? null;
  const failed = ordered.find((j) => j.status === "error") ?? null;
  const finished = status === "review" || status === "done";
  return (
    <div className="flex flex-col gap-4">
      {total > 0 && !finished && !failed ? (
        <p className="text-sm text-muted-fg">
          {t("activity.stageOf", { current: Math.min(doneCount + 1, total), total })}
        </p>
      ) : null}
      {total === 0 && !finished ? (
        <p className="text-sm text-muted-fg">{t("extraction.waiting")}</p>
      ) : null}
      <ol className="flex flex-col gap-2">
        {ordered.map((j) => (
          <li key={j.id} className="flex flex-col gap-1 rounded-md border border-border p-3">
            <div className="flex items-center gap-2 text-sm">
              {j.status === "done" ? (
                <CheckCircle2 size={16} className="text-ok" aria-hidden />
              ) : j.status === "error" ? (
                <XCircle size={16} className="text-danger" aria-hidden />
              ) : j.status === "active" || j.status === "stalled" ? (
                <Loader2 size={16} className="animate-spin text-primary" aria-hidden />
              ) : (
                <Circle size={16} className="text-muted-fg" aria-hidden />
              )}
              <span className={j.id === current?.id ? "font-medium" : ""}>
                {stageLabel(j.stage)}
              </span>
              {j.status === "stalled" ? (
                <span className="text-xs text-warn">{t("activity.status.stalled")}</span>
              ) : null}
            </div>
            {j.status === "active" ? (
              <Progress value={j.progress} label={stageLabel(j.stage)} />
            ) : null}
          </li>
        ))}
      </ol>
      {failed ? (
        <Alert tone="danger" className="flex flex-col gap-2">
          <span>
            {t("extraction.stageError", {
              stage: stageLabel(failed.stage),
              error: failed.error ?? "",
            })}
          </span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => onRetryJob(failed.id)}>
              {t("extraction.retryStage")}
            </Button>
            <Button size="sm" variant="outline" onClick={onSkip}>
              {t("extraction.skipToManual")}
            </Button>
          </div>
        </Alert>
      ) : null}
      {finished ? (
        <div className="flex items-center justify-between rounded-md border border-ok/40 bg-ok/10 p-3 text-sm">
          <span>{t("extraction.done")}</span>
          <Button onClick={onContinue}>{t("extraction.continue")}</Button>
        </div>
      ) : null}
    </div>
  );
}
