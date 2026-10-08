import type { ProfileCardResponse } from "@narnia-jobs/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useApi, useWs } from "../app/context";
import { profileKey } from "./useProfiles";

export const profileCardKey = (id: string) => [...profileKey(id), "card"] as const;

/** Cartão do perfil (F02 §2.2): reconstruído pela API quando inválido; `profile.card_invalidated` recarrega. */
export function useProfileCard(id: string | undefined) {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const key = profileCardKey(id ?? "none");
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.getProfileCard(id as string),
    enabled: Boolean(id),
  });
  useEffect(() => {
    if (!id) return;
    ws.connect();
    return ws.subscribe((event) => {
      if (event.type === "profile.card_invalidated" && event.profileIds.includes(id)) {
        void qc.invalidateQueries({ queryKey: profileCardKey(id) });
      }
    });
  }, [id, ws, qc]);
  const rebuild = useMutation({
    mutationFn: () => api.rebuildProfileCard(id as string),
    onSuccess: (card: ProfileCardResponse) => {
      qc.setQueryData(profileCardKey(card.profileId), card);
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  return { ...query, rebuild };
}
