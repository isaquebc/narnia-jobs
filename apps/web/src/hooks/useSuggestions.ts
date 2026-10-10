import type { AnalyzeRequest } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useApi, useWs } from "../app/context";
import { jobsKey } from "./useJobs";

/** Chave própria (auditoria F02-13): não pode ser prefixo de ["profiles"], senão toda ação de perfil refaz o GET. */
export const suggestionsKey = ["suggestions"] as const;

/** Sugestões de perfil (F02 §2.6): uma chamada por tela; recarrega em `profile.switched` e ao concluir a análise. */
/** `markSeen`: usado pela página de perfis; a abertura resolve a notificação "análise concluída" (F03-10). */
export function useSuggestions(opts: { enabled?: boolean; markSeen?: boolean } = {}) {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: suggestionsKey,
    queryFn: async () => (await api.listSuggestions({ seen: opts.markSeen ?? false })).suggestions,
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
  });
  // o job de análise grava sugestões do modelo; ao concluir, recarrega
  useEffect(() => {
    ws.connect();
    return ws.subscribe((event) => {
      if (event.type === "profile.switched") {
        void qc.invalidateQueries({ queryKey: suggestionsKey });
        return;
      }
      if (event.type === "job.done" && event.jobId.startsWith("task__profile.analyze__")) {
        void qc.invalidateQueries({ queryKey: suggestionsKey });
        void qc.invalidateQueries({ queryKey: ["dashboard"] });
      }
    });
  }, [ws, qc]);
  const dismiss = useMutation({
    mutationFn: (id: string) => api.dismissSuggestion(id),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: suggestionsKey }),
        qc.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
  return { ...query, suggestions: query.data ?? [], dismiss };
}

/** "Analisar possíveis perfis" (F02-5): estimativa antes, confirmação, job na bandeja. */
export function useAnalyzeProfiles() {
  const api = useApi();
  const qc = useQueryClient();
  const estimate = useQuery({
    queryKey: ["profiles", "analyze", "estimate"],
    queryFn: () => api.getAnalyzeEstimate(),
    enabled: false,
  });
  const run = useMutation({
    mutationFn: (body: AnalyzeRequest) => api.analyzeProfiles(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobsKey }),
  });
  return { estimate, run };
}
