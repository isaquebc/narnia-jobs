import type { Job, WsEvent } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useApi, useWs } from "../app/context";

export const jobsKey = ["jobs"] as const;
const ACTIVE = new Set<Job["status"]>(["queued", "active", "stalled"]);

const isJobEvent = (e: WsEvent): e is Extract<WsEvent, { jobId: string }> => "jobId" in e;

function applyWsEvent(jobs: Job[], event: WsEvent): Job[] {
  if (!isJobEvent(event)) return jobs;
  const idx = jobs.findIndex((j) => j.id === event.jobId);
  if (idx < 0) return jobs;
  const current = jobs[idx] as Job;
  let next: Job = current;
  if (event.type === "job.progress") {
    next = { ...current, status: "active", stage: event.stage, progress: event.progress };
  } else if (event.type === "job.done") {
    next = { ...current, status: "done", progress: 100 };
  } else if (event.type === "job.error") {
    next = { ...current, status: "error", error: event.error };
  }
  const copy = jobs.slice();
  copy[idx] = next;
  return copy;
}

/** Jobs da bandeja (F01 §4): lista inicial pela API, atualizações pelo WS, revalidação ao concluir. */
export function useJobs() {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: jobsKey,
    queryFn: async () => (await api.listJobs()).jobs,
    refetchInterval: (q) => ((q.state.data ?? []).some((j) => ACTIVE.has(j.status)) ? 5000 : false),
  });

  useEffect(() => {
    ws.connect();
    return ws.subscribe((event) => {
      if (!isJobEvent(event)) return;
      const known = (qc.getQueryData<Job[]>(jobsKey) ?? []).some((j) => j.id === event.jobId);
      if (!known) {
        void qc.invalidateQueries({ queryKey: jobsKey });
        return;
      }
      qc.setQueryData<Job[]>(jobsKey, (old) => applyWsEvent(old ?? [], event));
      if (event.type !== "job.progress") void qc.invalidateQueries({ queryKey: jobsKey });
    });
  }, [ws, qc]);

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelJob(id),
    onSettled: () => qc.invalidateQueries({ queryKey: jobsKey }),
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.retryJob(id),
    onSettled: () => qc.invalidateQueries({ queryKey: jobsKey }),
  });

  const jobs = query.data ?? [];
  return {
    jobs,
    activeCount: jobs.filter((j) => ACTIVE.has(j.status)).length,
    isLoading: query.isLoading,
    error: query.error,
    cancel,
    retry,
  };
}
