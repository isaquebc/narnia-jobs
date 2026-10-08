import type { ProfileCreateRequest } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useApi, useWs } from "../app/context";

export const profilesKey = ["profiles"] as const;
export const profileKey = (id: string) => ["profile", id] as const;

/** Lista de perfis, ativo e ações (F02 §2.5). `profile.switched` de outra aba invalida a lista e o dashboard. */
export function useProfiles(opts: { includeArchived?: boolean } = {}) {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const includeArchived = opts.includeArchived ?? false;
  const query = useQuery({
    queryKey: [...profilesKey, { archived: includeArchived }],
    queryFn: async () =>
      (includeArchived ? await api.listProfiles({ archived: true }) : await api.listProfiles())
        .profiles,
  });

  useEffect(() => {
    ws.connect();
    return ws.subscribe((event) => {
      if (event.type !== "profile.switched") return;
      void qc.invalidateQueries({ queryKey: profilesKey });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      void qc.invalidateQueries({ queryKey: profileKey(event.profileId) });
    });
  }, [ws, qc]);

  const invalidateAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: profilesKey }),
      qc.invalidateQueries({ queryKey: ["dashboard"] }),
      qc.invalidateQueries({ queryKey: ["profile"] }),
    ]);
  };
  const activate = useMutation({
    mutationFn: (id: string) => api.activateProfile(id),
    onSuccess: invalidateAll,
  });
  const archive = useMutation({
    mutationFn: (id: string) => api.archiveProfile(id),
    onSuccess: invalidateAll,
  });
  const unarchive = useMutation({
    mutationFn: (id: string) => api.unarchiveProfile(id),
    onSuccess: invalidateAll,
  });
  const create = useMutation({
    mutationFn: (body: ProfileCreateRequest) => api.createProfile(body),
    onSuccess: invalidateAll,
  });
  const clone = useMutation({
    mutationFn: (input: { sourceId: string; body: ProfileCreateRequest }) =>
      api.cloneProfile(input.sourceId, input.body),
    onSuccess: invalidateAll,
  });
  const rename = useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      api.patchProfile(input.id, { name: input.name }),
    onSuccess: invalidateAll,
  });

  const profiles = query.data ?? [];
  const active = profiles.find((p) => p.isActive) ?? null;
  return { ...query, profiles, active, activate, archive, unarchive, create, clone, rename };
}
