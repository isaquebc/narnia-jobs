import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../../../app/context";
import { ErrorState } from "../../../components/ErrorState";
import { Card } from "../../../components/ui/card";
import { ingestionKey, useIngestion } from "../../../hooks/useIngestion";
import { jobsKey } from "../../../hooks/useJobs";
import { t } from "../../../i18n";
import { FileDigestCard } from "../components/FileDigestCard";
import { ProgressPanel } from "../components/ProgressPanel";
import type { StepProps } from "../Wizard";

export function StepExtraction({ state, go }: StepProps) {
  const api = useApi();
  const qc = useQueryClient();
  const ingestion = useIngestion(state.runId);
  const retry = useMutation({
    mutationFn: (jobId: string) => api.retryJob(jobId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: jobsKey });
      if (state.runId) void qc.invalidateQueries({ queryKey: ingestionKey(state.runId) });
    },
  });
  if (!state.runId) {
    return <ErrorState error={new Error(t("errors.notFound"))} />;
  }
  if (ingestion.isError)
    return <ErrorState error={ingestion.error} onRetry={() => void ingestion.refetch()} />;
  const data = ingestion.data;
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">{t("extraction.title")}</h2>
        <p className="text-sm text-muted-fg">{t("extraction.hint")}</p>
        <ProgressPanel
          status={data?.status ?? "queued"}
          jobs={data?.jobs ?? []}
          onRetryJob={(id) => retry.mutate(id)}
          onSkip={() => void go({ step: 4 })}
          onContinue={() => void go({ step: 4 })}
        />
      </Card>
      {data?.digest ? <FileDigestCard digest={data.digest} /> : null}
    </div>
  );
}
