import type { ScheduledTaskPatch } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useApi, useWs } from "../app/context";

export const scheduledKey = ["scheduled-tasks"] as const;

/** Tarefas agendadas (F14-12): lista pela API; o WS de cada execução recarrega a lista e o histórico. */
export function useScheduledTasks() {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: scheduledKey,
    queryFn: async () => (await api.listScheduledTasks()).tasks,
  });
  useEffect(() => {
    ws.connect();
    return ws.subscribe((e) => {
      if (e.type === "scheduled_run.updated") void qc.invalidateQueries({ queryKey: scheduledKey });
    });
  }, [ws, qc]);
  const patch = useMutation({
    mutationFn: (v: { id: string; patch: ScheduledTaskPatch }) =>
      api.patchScheduledTask(v.id, v.patch),
    onSettled: () => qc.invalidateQueries({ queryKey: scheduledKey }),
  });
  const runNow = useMutation({
    mutationFn: (id: string) => api.runScheduledTask(id),
    onSettled: () => qc.invalidateQueries({ queryKey: scheduledKey }),
  });
  return { tasks: query.data ?? [], isLoading: query.isLoading, patch, runNow };
}

export function useScheduledRuns(taskId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...scheduledKey, taskId, "runs"],
    queryFn: async () => (await api.listScheduledRuns(taskId)).runs,
    enabled,
  });
}

export function useScheduledRun(runId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: [...scheduledKey, "run", runId],
    queryFn: () => api.getScheduledRun(runId as string),
    enabled: !!runId,
  });
}
