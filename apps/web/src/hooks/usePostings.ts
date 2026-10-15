import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useApi, useWs } from "../app/context";

/** Chaves das vagas (F06): a lista, o detalhe, as análises e as notas esperando confirmação. */
export const postingKeys = {
  all: ["postings"] as const,
  list: ["postings", "list"] as const,
  detail: (id: string) => ["postings", "detail", id] as const,
  analyses: (id: string) => ["postings", "analyses", id] as const,
  pendingNotes: ["postings", "pending-notes"] as const,
};

/** Recarrega tudo das vagas quando uma muda (extração, análise, nota do recrutador) ou uma pendência muda. */
function usePostingEvents() {
  const ws = useWs();
  const qc = useQueryClient();
  useEffect(() => {
    ws.connect();
    return ws.subscribe((e) => {
      if (
        e.type === "posting.updated" ||
        (e.type === "notification.created" && e.notification.kind === "posting.note_pending") ||
        (e.type === "notification.updated" && e.notification.kind === "posting.note_pending")
      )
        void qc.invalidateQueries({ queryKey: postingKeys.all });
    });
  }, [ws, qc]);
}

export function usePostings() {
  const api = useApi();
  usePostingEvents();
  const q = useQuery({ queryKey: postingKeys.list, queryFn: () => api.listPostings() });
  return { ...q, postings: q.data?.postings ?? [] };
}

export function usePosting(id: string) {
  const api = useApi();
  usePostingEvents();
  const detail = useQuery({ queryKey: postingKeys.detail(id), queryFn: () => api.getPosting(id) });
  const analyses = useQuery({
    queryKey: postingKeys.analyses(id),
    queryFn: () => api.listPostingAnalyses(id),
  });
  return { detail, analyses };
}

/** Edições do recrutador esperando o usuário (bandeja "Aguardando você", F06-17). */
export function usePendingNotes(enabled = true) {
  const api = useApi();
  usePostingEvents();
  const q = useQuery({
    queryKey: postingKeys.pendingNotes,
    queryFn: () => api.listPendingNotes(),
    enabled,
  });
  return q.data?.notes ?? [];
}
