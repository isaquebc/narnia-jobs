import type { JobApplicationClosedReason } from "@narnia-jobs/shared";
import { Card, CardTitle } from "../../components/ui/card";
import { useJobApplicationFunnel } from "../../hooks/useJobApplications";
import { type TKey, t } from "../../i18n";
import { columnLabel } from "./JobApplicationsPage";

const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);
const days = (d: number) => t("jobApplications.funnel.days", { n: d.toLocaleString("pt-BR") });

/**
 * Funil (F07/M5): quantas estão em cada coluna agora, quantas chegaram a ela (pular colunas conta), dias médios em cada
 * uma (só das passagens que terminaram), a taxa de avanço entre colunas e os motivos de encerramento. Sem dados, "—".
 */
export function FunnelStats() {
  const q = useJobApplicationFunnel();
  const f = q.data;
  if (!f || f.total === 0) return null;
  return (
    <section aria-label={t("jobApplications.funnel.title")}>
      <Card className="flex flex-col gap-3">
        <CardTitle>{t("jobApplications.funnel.title")}</CardTitle>
        <ul className="grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
          {f.columns.map((c) => (
            <li key={c.column} className="flex flex-col rounded-md bg-muted/40 p-2">
              <span className="text-xs text-muted-fg">{columnLabel(c.column)}</span>
              <span className="text-lg font-semibold tabular-nums">{c.now}</span>
              <span className="text-xs text-muted-fg">
                {t("jobApplications.funnel.reached", { n: c.reached })}
                {c.avgDays !== null ? ` · ${days(c.avgDays)}` : ""}
              </span>
            </li>
          ))}
        </ul>
        <ul className="flex flex-wrap gap-3 text-sm">
          {f.rates.map((r) => (
            <li key={r.from}>
              {columnLabel(r.from)} → {columnLabel(r.to)}:{" "}
              <span className="font-semibold tabular-nums">{pct(r.rate)}</span>
            </li>
          ))}
        </ul>
        {Object.keys(f.closedReasons).length > 0 ? (
          <p className="text-xs text-muted-fg">
            {(Object.entries(f.closedReasons) as Array<[JobApplicationClosedReason, number]>)
              .map(([k, n]) => `${t(`jobApplications.closedReason.${k}` as TKey)}: ${n}`)
              .join(" · ")}
          </p>
        ) : null}
      </Card>
    </section>
  );
}
