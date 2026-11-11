import { useState } from "react";
import { JobRow } from "../../components/shell/ActivityTray";
import { TabPanel, Tabs } from "../../components/ui/tabs";
import { useJobs } from "../../hooks/useJobs";
import { t } from "../../i18n";
import { ScheduledTasksPanel } from "./ScheduledTasksPanel";

/**
 * Processos em segundo plano (F05 §2.7, infraestrutura de jobs caros): os ativos e na fila primeiro, depois os recentes,
 * com cancelar e tentar de novo (a mesma linha da bandeja). A aba "Tarefas agendadas" (F14-12) mostra as rotinas
 * periódicas com o histórico.
 */
const ACTIVE = new Set(["queued", "active", "stalled"]);

export function ProcessesPage() {
  const { jobs, cancel, retry } = useJobs();
  const [tab, setTab] = useState("jobs");
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
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "jobs", label: t("processes.tabs.jobs") },
          { value: "scheduled", label: t("processes.tabs.scheduled") },
        ]}
      >
        <TabPanel value="jobs" className="flex flex-col gap-4">
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
        </TabPanel>
        <TabPanel value="scheduled">
          <ScheduledTasksPanel />
        </TabPanel>
      </Tabs>
    </div>
  );
}
