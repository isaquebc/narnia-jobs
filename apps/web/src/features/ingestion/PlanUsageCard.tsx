import type { PlanUsage } from "@narnia-jobs/shared";
import { useTimezone } from "../../app/context";
import { t } from "../../i18n";
import { formatDate } from "../../lib/format";

type Window = { utilization: number | null; resetsAt: string | null } | null;

/** Diagnóstico do plano (F03-3 §1): a Anthropic publica percentuais das janelas, não o limite em tokens. */
export function PlanUsageCard({ usage }: { usage: PlanUsage | null | undefined }) {
  const tz = useTimezone();
  const line = (key: "fiveHour" | "sevenDay", w: Window) => {
    if (!w || w.utilization === null) return null;
    const reset = w.resetsAt ? t("plan.resets", { date: formatDate(w.resetsAt, tz) }) : "";
    return (
      <span className="text-sm">
        {t(`plan.window.${key}`, { pct: Math.round(w.utilization) })}
        {reset ? ` · ${reset}` : ""}
      </span>
    );
  };
  return (
    <section
      aria-label={t("plan.title")}
      className="flex flex-col gap-1 rounded-md border border-border p-3"
    >
      <h3 className="text-sm font-semibold">{t("plan.title")}</h3>
      {usage ? (
        <>
          <span className="text-sm">
            {t("plan.subscription", { name: usage.subscription ?? "?" })}
          </span>
          {line("fiveHour", usage.windows.fiveHour)}
          {line("sevenDay", usage.windows.sevenDay)}
        </>
      ) : (
        <span className="text-sm text-muted-fg">{t("plan.unavailable")}</span>
      )}
    </section>
  );
}
