import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useApi, useWs } from "../app/context";
import type { DocumentStatus } from "../lib/api";

/** Chaves dos documentos (F05): por perfil ou vaga e o detalhe. */
export const documentKeys = {
  all: ["documents"] as const,
  list: (f: { profileId?: string | undefined; postingId?: string | undefined }) =>
    ["documents", "list", f.profileId ?? "", f.postingId ?? ""] as const,
  detail: (id: string) => ["documents", "detail", id] as const,
};

const ACTIVE: ReadonlySet<DocumentStatus> = new Set([
  "queued",
  "collecting",
  "generating",
  "validating",
  "rendering",
  "checking",
  "reviewing",
  "retrying",
]);
export const isDocumentActive = (s: DocumentStatus | undefined | null) =>
  Boolean(s && ACTIVE.has(s));

/** Recarrega os documentos a cada etapa (`document.updated`) e quando um aviso de documento chega. */
export function useDocumentEvents() {
  const ws = useWs();
  const qc = useQueryClient();
  useEffect(() => {
    ws.connect();
    return ws.subscribe((e) => {
      if (
        e.type === "document.updated" ||
        ((e.type === "notification.created" || e.type === "notification.updated") &&
          e.notification.kind.startsWith("document."))
      )
        void qc.invalidateQueries({ queryKey: documentKeys.all });
    });
  }, [ws, qc]);
}

export function useDocuments(filter: { profileId?: string; postingId?: string }) {
  const api = useApi();
  useDocumentEvents();
  const q = useQuery({
    queryKey: documentKeys.list(filter),
    queryFn: () => api.listDocuments(filter),
  });
  return { ...q, documents: q.data?.documents ?? [] };
}
