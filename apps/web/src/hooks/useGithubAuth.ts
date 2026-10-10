import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useApi, useWs } from "../app/context";
import type { GithubAuthSource } from "../lib/api";

export const githubAuthKey = ["github", "auth"] as const;

/**
 * Conexão do GitHub (F03-1): origem da credencial (gh do computador ou login próprio), fluxo de dispositivo e
 * `github.auth_updated` pelo WS, que chega quando a autorização termina na outra aba.
 */
export function useGithubAuth() {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: githubAuthKey, queryFn: () => api.getGithubAuth() });
  useEffect(() => {
    ws.connect();
    return ws.subscribe((event) => {
      if (event.type === "github.auth_updated") {
        qc.setQueryData(githubAuthKey, event.status);
        void qc.invalidateQueries({ queryKey: ["github", "preview"] });
      }
    });
  }, [ws, qc]);
  const setSource = useMutation({
    mutationFn: (source: GithubAuthSource) => api.setGithubAuthSource(source),
    onSuccess: (status) => qc.setQueryData(githubAuthKey, status),
  });
  const startDevice = useMutation({ mutationFn: () => api.startGithubDevice() });
  const disconnect = useMutation({
    mutationFn: () => api.disconnectGithub(),
    onSuccess: (status) => qc.setQueryData(githubAuthKey, status),
  });
  return { ...query, setSource, startDevice, disconnect };
}
