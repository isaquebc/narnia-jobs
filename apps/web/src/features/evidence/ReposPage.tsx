import { t } from "../../i18n";

/** Evidências › Repositórios (F03 §4): lista com relevância, última análise e métricas. */
export function ReposPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("evidence.title")}</h1>
    </div>
  );
}
