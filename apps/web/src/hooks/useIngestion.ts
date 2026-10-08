import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useApi, useWs } from "../app/context";

const RUNNING = new Set(["estimating", "queued", "running"]);

export function ingestionKey(runId: string) {
  return ["ingestion", runId] as const;
}

/** Ingestão em andamento: polling enquanto roda + invalidação por eventos WS de jobs. */
export function useIngestion(runId: string | undefined) {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ingestionKey(runId ?? "none"),
    queryFn: () => api.getIngestion(runId as string),
    enabled: Boolean(runId),
    refetchInterval: (q) => (q.state.data && RUNNING.has(q.state.data.status) ? 2000 : false),
  });
  useEffect(() => {
    if (!runId) return;
    ws.connect();
    return ws.subscribe((event) => {
      if (event.type !== "provider.status" && event.jobId.startsWith(`${runId}__`)) {
        void qc.invalidateQueries({ queryKey: ingestionKey(runId) });
      }
    });
  }, [runId, ws, qc]);
  return query;
}
