import type { RunStatus } from "@narnia-jobs/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useApi, useTimezone, useWs } from "../../app/context";
import { NavLink } from "../../components/shell/NavLink";
import { Badge } from "../../components/ui/badge";
import { type TKey, t } from "../../i18n";
import { formatDate } from "../../lib/format";
import { runHeadline } from "./runHeadline";

/** Estados em que a execução ainda está andando ou espera o usuário (lista de pendências, F03-3 §6). */
export const OPEN_STATUSES: RunStatus[] = [
  "estimating",
  "queued",
  "running",
  "awaiting_confirmation",
  "awaiting_decision",
  "paused",
  "review",
  "error",
];

export const STATUS_TONE: Partial<
  Record<RunStatus, "info" | "warn" | "danger" | "ok" | "neutral">
> = {
  awaiting_confirmation: "warn",
  awaiting_decision: "warn",
  paused: "warn",
  review: "info",
  error: "danger",
  done: "ok",
};

export function PendingRuns() {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const tz = useTimezone();
  const runs = useQuery({
    queryKey: ["ingestions", "open"],
    queryFn: () => api.listIngestions({ status: OPEN_STATUSES }),
  });
  useEffect(() => {
    ws.connect();
    return ws.subscribe((event) => {
      if (event.type === "ingestion.updated")
        void qc.invalidateQueries({ queryKey: ["ingestions"] });
    });
  }, [ws, qc]);
  const list = runs.data?.runs ?? [];
  if (list.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">{t("ingestion.pending")}</h2>
      <ul aria-label={t("ingestion.pending")} className="flex flex-col gap-2">
        {list.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
          >
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">
                {t(`ingestion.sources.${r.source}` as TKey)}
              </span>
              <span className="text-xs text-muted-fg">{formatDate(r.createdAt, tz)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={r.progress?.stuck ? "warn" : (STATUS_TONE[r.status] ?? "neutral")}>
                {runHeadline(r.status, r.progress)}
              </Badge>
              <NavLink
                to={`/ingestao/${r.id}`}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted"
              >
                {t("ingestion.open")}
              </NavLink>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
