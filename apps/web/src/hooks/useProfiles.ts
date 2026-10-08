import { useQuery } from "@tanstack/react-query";
import { useApi } from "../app/context";

export const profilesKey = ["profiles"] as const;

export function useProfiles() {
  const api = useApi();
  const query = useQuery({
    queryKey: profilesKey,
    queryFn: async () => (await api.listProfiles()).profiles,
  });
  const active = (query.data ?? []).find((p) => p.isActive) ?? null;
  return { ...query, profiles: query.data ?? [], active };
}
