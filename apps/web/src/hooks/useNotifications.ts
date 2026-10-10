import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useApi, useWs } from "../app/context";

export type NotificationFilter = "open" | "resolved" | "all";
export const notificationsKey = (filter: NotificationFilter) => ["notifications", filter] as const;

/**
 * Pendências (F03-10): lista e contagem de não resolvidas; `notification.created`/`updated` pelo WS recarregam.
 * Quem resolve uma pendência é o fluxo dono do assunto (revisão salva, decisão tomada); ler e dispensar só marcam.
 */
export function useNotifications(filter: NotificationFilter = "open") {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: notificationsKey(filter),
    queryFn: () => api.listNotifications(filter),
  });
  useEffect(() => {
    ws.connect();
    return ws.subscribe((event) => {
      if (event.type === "notification.created" || event.type === "notification.updated") {
        void qc.invalidateQueries({ queryKey: ["notifications"] });
      }
    });
  }, [ws, qc]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications"] });
  const markRead = useMutation({
    mutationFn: (id: string) => api.readNotification(id),
    onSettled: refresh,
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => api.dismissNotification(id),
    onSettled: refresh,
  });
  return {
    ...query,
    notifications: query.data?.notifications ?? [],
    unresolved: query.data?.unresolved ?? 0,
    markRead,
    dismiss,
  };
}
