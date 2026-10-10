import type { IngestionEstimateResponse } from "@narnia-jobs/shared";
import { t } from "../../i18n";
import { shortTokens } from "./format";

/** Estimativa antes de rodar (F03 §2.4): total, recomendado, fatia por repositório e aviso de aproximação. */
export function EstimateCard({
  estimate,
  loading,
}: {
  estimate: IngestionEstimateResponse | undefined;
  loading?: boolean;
}) {
  return (
    <section
      aria-label={t("estimate.title")}
      className="flex flex-col gap-1 rounded-md border border-border p-3"
    >
      <h3 className="text-sm font-semibold">{t("estimate.title")}</h3>
      {loading && !estimate ? (
        <span className="text-sm text-muted-fg">{t("app.loading")}</span>
      ) : null}
      {estimate ? (
        <>
          <span className="text-lg font-semibold">
            {t("estimate.total", { tokens: shortTokens(estimate.totalTokens) })}
          </span>
          {estimate.perRepo !== null ? (
            <>
              <span className="text-sm">
                {t("estimate.recommended", { tokens: shortTokens(estimate.recommendedBudget) })}
              </span>
              <span className="text-sm">
                {t("estimate.perRepo", { tokens: shortTokens(estimate.perRepo) })}
              </span>
            </>
          ) : null}
          {estimate.approximate ? (
            <span className="text-xs text-warn">{t("estimate.approximate")}</span>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
