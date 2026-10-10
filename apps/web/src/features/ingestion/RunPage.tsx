import { t } from "../../i18n";

/** Execução de ingestão (F03 §4): progresso, decisão no freio, revisão e relatório. */
export function RunPage({ runId }: { runId: string }) {
  return (
    <div className="flex flex-col gap-4" data-run-id={runId}>
      <h1 className="text-xl font-semibold">{t("run.title")}</h1>
    </div>
  );
}
