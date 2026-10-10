import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../app/context";
import type { RepoDigestInput } from "../lib/api";

export const reposKey = ["repos"] as const;
export const repoKey = (id: string) => ["repos", id] as const;

/** Repositórios analisados (F03 §4 Evidências). */
export function useRepos() {
  const api = useApi();
  return useQuery({ queryKey: reposKey, queryFn: () => api.listRepos() });
}

/** Detalhe do repositório: análises, digest e métricas; editar o digest e pedir reanálise. */
export function useRepo(id: string) {
  const api = useApi();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: repoKey(id), queryFn: () => api.getRepo(id) });
  const saveDigest = useMutation({
    mutationFn: (body: RepoDigestInput) => api.putRepoDigest(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: repoKey(id) }),
  });
  const reanalyze = useMutation({
    mutationFn: (kind: "incremental" | "deepen" | "cover") => api.reanalyzeRepo(id, { kind }),
  });
  return { ...query, saveDigest, reanalyze };
}
