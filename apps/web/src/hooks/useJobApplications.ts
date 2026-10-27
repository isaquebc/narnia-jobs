import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useApi, useWs } from "../app/context";

/** Chaves das candidaturas (F07): a lista (busca e arquivadas), o detalhe e as opções do Aplicar de cada vaga. */
export const jobApplicationKeys = {
  all: ["job-applications"] as const,
  list: (q: string, archived: boolean) => ["job-applications", "list", q, archived] as const,
  detail: (id: string) => ["job-applications", "detail", id] as const,
  options: (postingId: string) => ["job-applications", "options", postingId] as const,
};

/** Recarrega tudo das candidaturas quando uma muda (criada, movida, arquivada, apagada). */
function useJobApplicationEvents() {
  const ws = useWs();
  const qc = useQueryClient();
  useEffect(() => {
    ws.connect();
    return ws.subscribe((e) => {
      if (e.type === "job_application.updated")
        void qc.invalidateQueries({ queryKey: jobApplicationKeys.all });
    });
  }, [ws, qc]);
}

export function useJobApplications(q: string, archived: boolean) {
  const api = useApi();
  useJobApplicationEvents();
  const query = useQuery({
    queryKey: jobApplicationKeys.list(q, archived),
    queryFn: () => api.listJobApplications({ q, archived }),
    placeholderData: keepPreviousData,
  });
  return { ...query, applications: query.data?.applications ?? [] };
}

export function useJobApplication(id: string) {
  const api = useApi();
  useJobApplicationEvents();
  return useQuery({
    queryKey: jobApplicationKeys.detail(id),
    queryFn: () => api.getJobApplication(id),
  });
}

export function useApplyOptions(postingId: string) {
  const api = useApi();
  useJobApplicationEvents();
  return useQuery({
    queryKey: jobApplicationKeys.options(postingId),
    queryFn: () => api.getApplyOptions(postingId),
  });
}
