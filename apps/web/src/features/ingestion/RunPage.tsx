import type { IngestionDecisionRequest } from "@narnia-jobs/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useApi } from "../../app/context";
import { describeError, ErrorState } from "../../components/ErrorState";
import { stageLabel } from "../../components/shell/ActivityTray";
import { NavLink } from "../../components/shell/NavLink";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { ingestionKey, useIngestion } from "../../hooks/useIngestion";
import { type TKey, t } from "../../i18n";
import type { IngestionDetail } from "../../lib/api";
import { BudgetDecisionDialog } from "./BudgetDecisionDialog";
import { FriendlyError } from "./FriendlyError";
import { shortTokens } from "./format";
import { STATUS_TONE } from "./PendingRuns";
import { ReviewPanel } from "./ReviewPanel";
import { RunReportView } from "./RunReportView";
import { RunTimeline } from "./RunTimeline";
import { runHeadline } from "./runHeadline";

const ACTIVE = new Set(["estimating", "queued", "running"]);

function RepoProgress({
  run,
  onRetryRepo,
  retrying,
}: {
  run: IngestionDetail;
  onRetryRepo?: (fullName: string) => void;
  retrying?: boolean;
}) {
  const repos = run.report?.repos ?? [];
  const done = repos.filter((r) => r.status === "done").length;
  return (
    <div className="flex flex-col gap-2">
      {repos.length > 0 ? (
        <span className="text-sm">{t("runPage.progress", { done, total: repos.length })}</span>
      ) : null}
      {run.report && run.budget ? (
        <span className="text-sm">
          {t("runPage.usage", {
            used: shortTokens(run.report.totals.used),
            budget: shortTokens(run.budget.amount),
          })}
        </span>
      ) : null}
      {repos.length > 0 ? (
        <ul aria-label={t("runPage.repos")} className="flex flex-col gap-1">
          {repos.map((r) => (
            <li key={r.fullName} className="flex items-center justify-between gap-2 text-sm">
              <span>{r.fullName}</span>
              <span className="flex items-center gap-2">
                <Badge>{t(`report.repoStatus.${r.status}` as TKey)}</Badge>
                {onRetryRepo && r.status === "error" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={retrying}
                    onClick={() => onRetryRepo(r.fullName)}
                  >
                    {t("runPage.retryRepo")}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : run.timeline ? null : (
        <ul className="flex flex-col gap-1">
          {run.jobs.map((j) => (
            <li key={j.id} className="flex items-center justify-between text-sm">
              <span>{stageLabel(j.stage)}</span>
              <Badge>{t(`activity.status.${j.status}` as TKey)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Execução de ingestão (F03 §4): confirmação, progresso, freio, pausa, revisão, relatório, erro e cancelamento. */
export function RunPage({ runId }: { runId: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const query = useIngestion(runId);
  const run = query.data;
  const [dialog, setDialog] = useState(false);
  const status = run?.status;

  useEffect(() => {
    if (status === "awaiting_decision") setDialog(true);
  }, [status]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ingestionKey(runId) });
    void qc.invalidateQueries({ queryKey: ["ingestions"] });
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  const confirm = useMutation({
    mutationFn: () => api.confirmIngestion(runId),
    onSuccess: refresh,
  });
  const cancel = useMutation({ mutationFn: () => api.cancelIngestion(runId), onSuccess: refresh });
  const retry = useMutation({ mutationFn: () => api.retryIngestion(runId), onSuccess: refresh });
  // C4 (CM-5): refazer um repositório falho na mesma execução, enquanto a revisão não foi salva
  const retryRepo = useMutation({
    mutationFn: (fullName: string) => api.retryIngestionRepo(runId, fullName),
    onSuccess: refresh,
  });
  const decide = useMutation({
    mutationFn: (d: IngestionDecisionRequest) => api.decideIngestion(runId, d),
    onSuccess: refresh,
    onSettled: () => setDialog(false),
  });

  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!run) return <p className="text-sm text-muted-fg">{t("app.loading")}</p>;
  const err = confirm.error ?? cancel.error ?? retry.error ?? retryRepo.error ?? decide.error;
  const canRetryRepo =
    run.source === "github" && ["running", "error", "review"].includes(run.status);
  const repoActions = canRetryRepo
    ? { onRetryRepo: (f: string) => retryRepo.mutate(f), retrying: retryRepo.isPending }
    : {};
  const tl = run.timeline;
  const progress = tl
    ? {
        current: tl.current,
        total: tl.total,
        stepKey: tl.current ? (tl.steps[tl.current - 1]?.key ?? null) : null,
        stuck: tl.stuck,
      }
    : null;
  const failedTask = run.failedTaskType ?? null;

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      {run.parentRunId || (run.childRunIds?.length ?? 0) > 0 ? (
        <nav aria-label={t("runPage.links")} className="flex flex-wrap gap-3 text-sm">
          {run.parentRunId ? (
            <NavLink to={`/ingestao/${run.parentRunId}`} className="underline">
              {t("runPage.parentRun")}
            </NavLink>
          ) : null}
          {(run.childRunIds ?? []).map((id, i) => (
            <NavLink key={id} to={`/ingestao/${id}`} className="underline">
              {t("runPage.childRun", { n: i + 1 })}
            </NavLink>
          ))}
        </nav>
      ) : null}
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{t("run.title")}</h1>
        <span className="text-sm text-muted-fg">
          {t(`ingestion.sources.${run.source ?? "cv"}` as TKey)}
        </span>
        <Badge tone={progress?.stuck ? "warn" : (STATUS_TONE[run.status] ?? "neutral")}>
          {runHeadline(run.status, progress)}
        </Badge>
      </div>
      {err ? <Alert tone="danger">{describeError(err).title}</Alert> : null}

      {tl ? (
        <Card>
          <RunTimeline timeline={tl} />
        </Card>
      ) : null}

      {run.status === "awaiting_confirmation" ? (
        <Card className="flex flex-col gap-3">
          {run.budget ? (
            <span className="text-sm">
              {t("runPage.budget", {
                amount: shortTokens(run.budget.amount),
                perRepo: shortTokens(run.budget.perRepo),
              })}
            </span>
          ) : null}
          <div className="flex gap-2">
            <Button disabled={confirm.isPending} onClick={() => confirm.mutate()}>
              {t("runPage.confirm")}
            </Button>
            <Button variant="outline" onClick={() => cancel.mutate()}>
              {t("runPage.cancel")}
            </Button>
          </div>
        </Card>
      ) : null}

      {ACTIVE.has(run.status) ? (
        <Card className="flex flex-col gap-3">
          <RepoProgress run={run} {...repoActions} />
          <div>
            <Button variant="outline" onClick={() => cancel.mutate()}>
              {t("runPage.cancel")}
            </Button>
          </div>
        </Card>
      ) : null}

      {run.status === "awaiting_decision" || run.status === "paused" ? (
        <Card className="flex flex-col gap-3">
          <p className="text-sm">
            {run.status === "paused" ? t("runPage.pausedHint") : t("runPage.decisionHint")}
          </p>
          <RepoProgress run={run} />
          <div className="flex gap-2">
            <Button onClick={() => setDialog(true)}>
              {run.status === "paused" ? t("runPage.resume") : t("runPage.reviewDecision")}
            </Button>
            {!dialog ? (
              <Button variant="outline" onClick={() => decide.mutate({ action: "finish" })}>
                {t("brake.finish")}
              </Button>
            ) : null}
          </div>
          <BudgetDecisionDialog
            open={dialog}
            onOpenChange={setDialog}
            report={run.report}
            pending={decide.isPending}
            onDecide={(d) => decide.mutate(d)}
          />
        </Card>
      ) : null}

      {run.status === "error" ? (
        <Alert tone="danger" className="flex flex-col gap-2">
          {run.errorFriendly ? (
            <FriendlyError error={run.errorFriendly} />
          ) : (
            <span>{run.error ?? t("app.unknownError")}</span>
          )}
          {run.source === "github" ? (
            <div className="flex flex-col gap-1">
              <div>
                <Button size="sm" onClick={() => retry.mutate()}>
                  {failedTask
                    ? t(`runPage.redo.${failedTask.replace(/\./g, "_")}` as TKey)
                    : t("app.retry")}
                </Button>
              </div>
              {failedTask && failedTask !== "ingest.github.prepare" ? (
                <span className="text-xs">{t("runPage.redoKeeps")}</span>
              ) : null}
            </div>
          ) : null}
        </Alert>
      ) : null}

      {run.status === "cancelled" ? (
        <p className="text-sm text-muted-fg">{t("runPage.cancelled")}</p>
      ) : null}

      {(run.status === "error" || run.status === "review") &&
      (run.report?.repos.length ?? 0) > 0 ? (
        <Card className="flex flex-col gap-3">
          <RepoProgress run={run} {...repoActions} />
        </Card>
      ) : null}

      {run.status === "review" ? <ReviewPanel run={run} /> : null}

      {run.report && (run.status === "done" || run.status === "review") ? (
        <RunReportView report={run.report} />
      ) : null}
    </div>
  );
}
