import { t } from "../../i18n";

/** Nova ingestão (F03 §4): fontes GitHub, CV e texto livre; execuções pendentes. */
export function IngestionPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("ingestion.title")}</h1>
    </div>
  );
}
