import type { IngestionDecisionRequest, RunReport } from "@narnia-jobs/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useApi } from "../../app/context";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { t } from "../../i18n";
import { shortTokens } from "./format";
import { PlanUsageCard } from "./PlanUsageCard";

/** Repositórios que ainda faltam (na fila ou parados pelo limite) e quanto custaria terminar (F03-3 §6). */
export function costToFinish(report: RunReport | null | undefined): {
  tokens: number;
  repos: number;
} {
  const left = (report?.repos ?? []).filter(
    (r) => r.status === "pending" || r.status === "skipped_budget",
  );
  return { tokens: left.reduce((acc, r) => acc + r.estimatedTokens, 0), repos: left.length };
}

/**
 * Freio do orçamento (F03-3 §6): gasto × estimado, janela do plano e renovação, custo para terminar; continuar com
 * orçamento extra, encerrar com o que já foi feito ou deixar para depois (a execução fica nas pendências).
 */
export function BudgetDecisionDialog({
  open,
  onOpenChange,
  report,
  pending,
  onDecide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  report: RunReport | null | undefined;
  pending: boolean;
  onDecide: (d: IngestionDecisionRequest) => void;
}) {
  const api = useApi();
  const plan = useQuery({
    queryKey: ["plan", "usage"],
    queryFn: () => api.getPlanUsage(),
    enabled: open,
  });
  const finish = costToFinish(report);
  const [extra, setExtra] = useState(String(finish.tokens / 1000));
  useEffect(() => {
    if (open) setExtra(String(finish.tokens / 1000));
  }, [open, finish.tokens]);
  const extraTokens = Math.max(0, Math.round(Number(extra) * 1000) || 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("brake.title")}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-fg">{t("brake.hint")}</p>
        {report ? (
          <span className="text-sm">
            {t("brake.spent", {
              used: shortTokens(report.totals.used),
              estimated: shortTokens(report.totals.estimated),
            })}
          </span>
        ) : null}
        <span className="text-sm">
          {t("brake.toFinish", { tokens: shortTokens(finish.tokens), count: finish.repos })}
        </span>
        <PlanUsageCard usage={plan.data?.usage} />
        <Field label={t("brake.extra")} htmlFor="brake-extra">
          <Input
            id="brake-extra"
            type="number"
            min={0}
            step="any"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            className="w-32"
          />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={pending} onClick={() => onDecide({ action: "later" })}>
            {t("brake.later")}
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onDecide({ action: "finish" })}
          >
            {t("brake.finish")}
          </Button>
          <Button
            disabled={pending}
            onClick={() => onDecide({ action: "continue", extraBudget: extraTokens })}
          >
            {t("brake.continue")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
