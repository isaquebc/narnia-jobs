import { type TKey, t } from "../../../i18n";
import { formatTokens } from "../../../lib/format";

export interface EstimateView {
  totalTokens: number;
  calls: Array<{
    name: "readDocument" | "extractFacts" | "buildDigest";
    model: string;
    tokens: number;
  }>;
}

const CALL_STAGE: Record<EstimateView["calls"][number]["name"], TKey> = {
  readDocument: "stages.extract_read_doc",
  extractFacts: "stages.extract_facts",
  buildDigest: "stages.extract_digest",
};

export function EstimateBadge({
  estimate,
  loading,
}: {
  estimate: EstimateView | null;
  loading: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-muted p-3 text-sm">
      <p className="font-medium">{t("source.estimate.title")}</p>
      {loading ? <p className="text-muted-fg">{t("source.estimate.loading")}</p> : null}
      {!loading && !estimate ? (
        <p className="text-muted-fg">{t("source.estimate.unavailable")}</p>
      ) : null}
      {!loading && estimate ? (
        <>
          <p>{t("source.estimate.total", { tokens: formatTokens(estimate.totalTokens) })}</p>
          <ul className="mt-1 text-xs text-muted-fg">
            {estimate.calls.map((c) => (
              <li key={c.name}>
                {t("source.estimate.call", {
                  label: t(CALL_STAGE[c.name]),
                  tokens: formatTokens(c.tokens),
                  model: c.model,
                })}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
