import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../../app/context";
import { NavLink } from "../../components/shell/NavLink";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { ingestionKey, useIngestion } from "../../hooks/useIngestion";
import { type TKey, t } from "../../i18n";
import { formatTokens } from "../../lib/format";
import { ReviewPanel } from "../ingestion/ReviewPanel";
import { runHeadline } from "../ingestion/runHeadline";

/**
 * Ingestão aberta pela conversa, administrada no painel da direita (pedido do dono, 2026-10-13): etapa e progresso
 * pelo WS (sem polling e sem o recrutador gastar tokens esperando), confirmação do custo e a revisão ali mesmo. Uma
 * por ingestão: as anteriores continuam no painel e mostram "Finalizada" quando tudo foi decidido e salvo.
 */
export function ChatIngestionCard({ runId }: { runId: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const query = useIngestion(runId, { poll: false });
  const confirm = useMutation({
    mutationFn: () => api.confirmIngestion(runId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ingestionKey(runId) }),
  });
  const run = query.data;
  const tl = run?.timeline;
  const progress = tl
    ? {
        current: tl.current,
        total: tl.total,
        stepKey: tl.current ? (tl.steps[tl.current - 1]?.key ?? null) : null,
        stuck: tl.stuck,
      }
    : null;
  const done = tl ? tl.steps.filter((s) => s.state === "done" || s.state === "skipped").length : 0;
  const est = run?.estimate
    ? run.estimate.documentTokens + run.estimate.factsTokens + run.estimate.digestTokens
    : null;
  return (
    <Card className="flex flex-col gap-3 p-3">
      <section aria-label={t("chat.ingestion.title")} className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">{t("chat.ingestion.title")}</CardTitle>
          <NavLink to={`/ingestao/${runId}`} className="text-xs underline">
            {t("chat.ingestion.open")}
          </NavLink>
        </div>
        {!run ? (
          <p className="text-xs text-muted-fg">{t("app.loading")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-fg">
                {t(`ingestion.sources.${run.source ?? "cv"}` as TKey)}
              </span>
              <Badge tone={run.status === "done" ? "ok" : progress?.stuck ? "warn" : "info"}>
                {runHeadline(run.status, progress)}
              </Badge>
            </div>
            {tl && ["estimating", "queued", "running"].includes(run.status) ? (
              <div
                role="progressbar"
                aria-label={t("chat.ingestion.progress")}
                aria-valuemin={0}
                aria-valuemax={tl.total}
                aria-valuenow={done}
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${tl.total ? Math.round((done / tl.total) * 100) : 0}%` }}
                />
              </div>
            ) : null}
            {run.status === "awaiting_confirmation" && run.fileId !== null ? (
              <div className="flex flex-col gap-2 text-xs">
                <span className="text-muted-fg">
                  {t("chat.runAwaiting", { tokens: formatTokens(est ?? 0) })}
                </span>
                <Button size="sm" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
                  {t("chat.runConfirm")}
                </Button>
                {confirm.isError ? (
                  <span className="text-danger">{(confirm.error as Error).message}</span>
                ) : null}
              </div>
            ) : null}
            {run.status === "error" ? (
              <Alert tone="danger">{run.error ?? t("chat.ingestion.failed")}</Alert>
            ) : null}
            {run.status === "review" ? <ReviewPanel run={run} variant="panel" /> : null}
            {run.status === "done" ? (
              <p className="text-xs text-muted-fg">{t("chat.ingestion.saved")}</p>
            ) : null}
          </>
        )}
      </section>
    </Card>
  );
}
