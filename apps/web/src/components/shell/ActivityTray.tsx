import type { Job, RunStatus } from "@narnia-jobs/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { useEffect, useState } from "react";
import { useApi, useWs } from "../../app/context";
import { runHeadline } from "../../features/ingestion/runHeadline";
import { useChatSessions } from "../../hooks/useChat";
import { useJobs } from "../../hooks/useJobs";
import { useNotifications } from "../../hooks/useNotifications";
import { usePendingNotes } from "../../hooks/usePostings";
import { type TKey, t } from "../../i18n";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import { NavLink } from "./NavLink";

const STAGE_ORDER = [
  "ingest.read_text",
  "ocr.pages",
  "extract.read_doc",
  "ingest.consolidate",
  "extract.facts",
  "extract.digest",
  "ingest.reconcile",
  "ingest.review_check",
];
/** Etapas fora da cadeia de arquivos (tarefas genéricas, F02/F03) e o estado `stalled` do worker. */
const OTHER_STAGES = [
  "ingest.github.prepare",
  "ingest.github.pick",
  "ingest.github.repo",
  "ingest.github.synthesis",
  "profile.analyze",
  "posting.extract",
  "stalled",
];

export function stageLabel(stage: string): string {
  if (!STAGE_ORDER.includes(stage) && !OTHER_STAGES.includes(stage)) return stage;
  return t(`stages.${stage.replaceAll(".", "_")}` as TKey);
}

export function stageIndex(stage: string): number {
  return STAGE_ORDER.indexOf(stage);
}

export function statusTone(status: Job["status"]): "neutral" | "ok" | "warn" | "danger" | "info" {
  switch (status) {
    case "done":
      return "ok";
    case "error":
      return "danger";
    case "stalled":
      return "warn";
    case "active":
      return "info";
    default:
      return "neutral";
  }
}

export function JobRow({
  job,
  onCancel,
  onRetry,
}: {
  job: Job;
  onCancel?: (id: string) => void;
  onRetry?: (id: string) => void;
}) {
  const canCancel = job.status === "queued" || job.status === "active" || job.status === "stalled";
  const canRetry = job.status === "error" || job.status === "cancelled";
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{stageLabel(job.stage)}</span>
        <Badge tone={statusTone(job.status)}>{t(`activity.status.${job.status}` as TKey)}</Badge>
      </div>
      {canCancel ? <Progress value={job.progress} label={stageLabel(job.stage)} /> : null}
      {job.error ? <p className="text-xs text-danger">{job.error}</p> : null}
      <div className="flex gap-2">
        {canCancel && onCancel ? (
          <Button variant="outline" size="sm" onClick={() => onCancel(job.id)}>
            {t("activity.cancel")}
          </Button>
        ) : null}
        {canRetry && onRetry ? (
          <Button variant="outline" size="sm" onClick={() => onRetry(job.id)}>
            {t("activity.retry")}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** Execuções que esperam o usuário (correções F03, item 16): aparecem na bandeja com "abrir". */
export const STOPPED_STATUSES: RunStatus[] = [
  "awaiting_confirmation",
  "awaiting_decision",
  "paused",
];

/** Execuções em andamento: a bandeja mostra a mesma frase "etapa x de y" da página (plano de comunicação C1). */
export const RUNNING_STATUSES: RunStatus[] = ["queued", "estimating", "running"];

function useRunsByStatus(key: string, statuses: RunStatus[]) {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const runs = useQuery({
    queryKey: ["ingestions", key],
    queryFn: () => api.listIngestions({ status: statuses }),
  });
  useEffect(() => {
    ws.connect();
    return ws.subscribe((event) => {
      if (event.type === "ingestion.updated")
        void qc.invalidateQueries({ queryKey: ["ingestions", key] });
    });
  }, [ws, qc, key]);
  return runs.data?.runs ?? [];
}

/**
 * Análises de vaga (correção 2026-10-15): a análise roda numa conversa do recrutador, não na fila, então a bandeja
 * mostra as conversas de vaga com turno em andamento (menos as da vaga que já tem a análise pronta), as análises
 * prontas ainda não vistas (`posting.analysis_done`; abrir pela bandeja marca como vista) e as conversas que
 * terminaram sem gravar (`posting.analysis_incomplete`, resolvida quando a análise é gravada). Tudo conta no número.
 */
function usePostingAnalyses() {
  const { sessions } = useChatSessions();
  const { notifications, markRead } = useNotifications("open");
  const done = notifications.filter((n) => n.kind === "posting.analysis_done" && !n.readAt);
  const incomplete = notifications.filter((n) => n.kind === "posting.analysis_incomplete");
  const ready = new Set(done.map((n) => n.subjectId));
  const running = sessions.filter(
    (s) =>
      s.category === "job" &&
      s.busy &&
      s.state !== "archived" &&
      !(s.postingId && ready.has(s.postingId)),
  );
  const count = running.length + done.length + incomplete.length;
  return { running, done, incomplete, count, markRead };
}

const useStoppedRuns = () => useRunsByStatus("stopped", STOPPED_STATUSES);
const useRunningRuns = () => useRunsByStatus("running", RUNNING_STATUSES);

export function ActivityTray({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const { jobs, activeCount, cancel, retry } = useJobs();
  const stopped = useStoppedRuns();
  const running = useRunningRuns();
  // "Aguardando você" (F06-17): edições do recrutador em notas do usuário, esperando confirmação
  const waiting = usePendingNotes();
  const analyses = usePostingAnalyses();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-label={t("activity.title")}
        onClick={() => setOpen((o) => !o)}
      >
        <Activity size={16} />
        <span data-testid="activity-count" className="text-xs">
          {activeCount + waiting.length + analyses.count}
        </span>
      </Button>
      {open ? (
        <section
          aria-label={t("activity.title")}
          className="absolute right-0 z-30 mt-2 max-h-[calc(100vh-5rem)] w-96 overflow-y-auto rounded-lg border border-border bg-card p-3 shadow-lg"
        >
          <h3 className="mb-2 text-sm font-semibold">{t("activity.title")}</h3>
          {waiting.length > 0 ? (
            <ul aria-label={t("tray.waiting")} className="mb-2 flex flex-col gap-2">
              {waiting.map(({ note, posting }) => (
                <li
                  key={note.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-warn/40 p-2 text-sm"
                >
                  <span>
                    {t("tray.noteChange", {
                      posting:
                        [posting?.company, posting?.title].filter(Boolean).join(" · ") || "—",
                    })}
                  </span>
                  <NavLink
                    to={`/vagas/${note.postingId}?nota=${note.id}`}
                    className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
                  >
                    {t("tray.review")}
                  </NavLink>
                </li>
              ))}
            </ul>
          ) : null}
          {analyses.count > 0 ? (
            <ul aria-label={t("tray.analyses")} className="mb-2 flex flex-col gap-2">
              {analyses.running.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm"
                >
                  <span>{t("tray.analyzing", { title: s.title })}</span>
                  <NavLink
                    to={`/chat/${s.id}`}
                    className="inline-flex h-8 shrink-0 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
                  >
                    {t("tray.openChat")}
                  </NavLink>
                </li>
              ))}
              {analyses.done.map((n) => (
                <li
                  key={n.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-ok/40 p-2 text-sm"
                >
                  <span>{n.title}</span>
                  <NavLink
                    to={n.actionUrl}
                    onClick={() => analyses.markRead.mutate(n.id)}
                    className="inline-flex h-8 shrink-0 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
                  >
                    {t("tray.viewAnalysis")}
                  </NavLink>
                </li>
              ))}
              {analyses.incomplete.map((n) => (
                <li
                  key={n.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-warn/40 p-2 text-sm"
                >
                  <span>{n.title}</span>
                  <NavLink
                    to={n.actionUrl}
                    className="inline-flex h-8 shrink-0 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
                  >
                    {t("tray.openChat")}
                  </NavLink>
                </li>
              ))}
            </ul>
          ) : null}
          {stopped.length > 0 ? (
            <ul aria-label={t("activity.stopped")} className="mb-2 flex flex-col gap-2">
              {stopped.map((run) => {
                const label = t(`run.status.${run.status}` as TKey);
                return (
                  <li
                    key={run.id}
                    aria-label={label}
                    className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm"
                  >
                    <Badge tone="warn">{label}</Badge>
                    <NavLink
                      to={`/ingestao/${run.id}`}
                      className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
                    >
                      {t("activity.open")}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {running.length > 0 ? (
            <ul aria-label={t("activity.runningRuns")} className="mb-2 flex flex-col gap-2">
              {running.map((run) => {
                const label = runHeadline(run.status, run.progress);
                return (
                  <li
                    key={run.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm"
                  >
                    <Badge tone={run.progress?.stuck ? "warn" : "info"}>{label}</Badge>
                    <NavLink
                      to={`/ingestao/${run.id}`}
                      className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
                    >
                      {t("activity.open")}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {jobs.length === 0 &&
          stopped.length === 0 &&
          running.length === 0 &&
          waiting.length === 0 &&
          analyses.count === 0 ? (
            <p className="text-sm text-muted-fg">{t("activity.empty")}</p>
          ) : (
            <ul className="flex max-h-96 flex-col gap-2 overflow-auto">
              {jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  onCancel={(id) => cancel.mutate(id)}
                  onRetry={(id) => retry.mutate(id)}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
