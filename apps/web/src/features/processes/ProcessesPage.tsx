import { JobRow } from "../../components/shell/ActivityTray";
import { useJobs } from "../../hooks/useJobs";
import { t } from "../../i18n";

/**
 * Processos em segundo plano (F05 §2.7, infraestrutura de jobs caros): os ativos e na fila primeiro, depois os recentes,
 * com cancelar e tentar de novo (a mesma linha da bandeja).
 */
const ACTIVE = new Set(["queued", "active", "stalled"]);

export function ProcessesPage() {
  const { jobs, cancel, retry } = useJobs();
  const running = jobs.filter((j) => ACTIVE.has(j.status));
  const recent = jobs.filter((j) => !ACTIVE.has(j.status));
  const row = (j: (typeof jobs)[number]) => (
    <JobRow
      key={j.id}
      job={j}
      onCancel={(id) => cancel.mutate(id)}
      onRetry={(id) => retry.mutate(id)}
    />
  );
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("processes.title")}</h1>
        <p className="text-sm text-muted-fg">{t("processes.hint")}</p>
      </div>
      <section aria-label={t("processes.running")} className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{t("processes.running")}</h2>
        {running.length ? (
          <ul className="flex flex-col gap-2">{running.map(row)}</ul>
        ) : (
          <p className="text-sm text-muted-fg">{t("processes.empty")}</p>
        )}
      </section>
      {recent.length ? (
        <section aria-label={t("processes.recent")} className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">{t("processes.recent")}</h2>
          <ul className="flex flex-col gap-2">{recent.map(row)}</ul>
        </section>
      ) : null}
    </div>
  );
}
