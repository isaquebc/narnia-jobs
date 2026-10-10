import type { RunReport } from "@narnia-jobs/shared";
import { useTimezone } from "../../app/context";
import { Badge } from "../../components/ui/badge";
import { type TKey, t } from "../../i18n";
import { formatDate } from "../../lib/format";
import { shortTokens } from "./format";

/** Relatório da execução (F03-3 §2): estimado × usado, por repositório, paradas, o que ficou de fora e síntese. */
export function RunReportView({ report }: { report: RunReport }) {
  const tz = useTimezone();
  return (
    <section
      aria-label={t("report.title")}
      className="flex flex-col gap-2 rounded-md border border-border p-3"
    >
      <h2 className="text-base font-semibold">{t("report.title")}</h2>
      <span className="text-sm">
        {t("report.totals", {
          estimated: shortTokens(report.totals.estimated),
          used: shortTokens(report.totals.used),
        })}
      </span>
      {report.synthesis ? <p className="text-sm">{report.synthesis}</p> : null}
      <table className="text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-fg">
            <th>{t("report.repo")}</th>
            <th>{t("report.estimated")}</th>
            <th>{t("report.used")}</th>
            <th>{t("report.status")}</th>
          </tr>
        </thead>
        <tbody>
          {report.repos.map((r) => (
            <tr key={r.fullName}>
              <td>{r.fullName}</td>
              <td>{shortTokens(r.estimatedTokens)}</td>
              <td>{shortTokens(r.usedTokens)}</td>
              <td>
                <Badge>{t(`report.repoStatus.${r.status}` as TKey)}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.stops.map((s) => (
        <span key={s.at} className="text-xs text-muted-fg">
          {t("report.stop", {
            reason: s.reason === "budget" ? t("report.stopBudget") : s.reason,
            date: formatDate(s.at, tz),
            used: shortTokens(s.usedTokens),
          })}
        </span>
      ))}
      {report.skipped.length > 0 ? (
        <span className="text-xs text-muted-fg">
          {t("report.skipped", { repos: report.skipped.join(", ") })}
        </span>
      ) : null}
    </section>
  );
}
