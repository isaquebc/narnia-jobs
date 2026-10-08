import type { EmphasisPutRequest } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../app/context";
import { profileCardKey } from "./useProfileCard";
import { profileKey } from "./useProfiles";

export const emphasisKey = (id: string) => [...profileKey(id), "emphasis"] as const;

/** Ênfases do perfil (F02 §2.1): lista com fatos resolvidos e salvamento em lote. */
export function useEmphasis(id: string) {
  const api = useApi();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: emphasisKey(id), queryFn: () => api.getEmphasis(id) });
  const save = useMutation({
    mutationFn: (body: EmphasisPutRequest) => api.putEmphasis(id, body),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: emphasisKey(id) }),
        qc.invalidateQueries({ queryKey: profileCardKey(id) }),
        qc.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
  return { ...query, items: query.data?.items ?? [], save };
}
