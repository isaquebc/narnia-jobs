import type { ProviderStatusResponse } from "@narnia-jobs/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useApi, useWs } from "../app/context";

export const providerKey = ["provider", "status"] as const;

export function useProviderStatus() {
  const api = useApi();
  const ws = useWs();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: providerKey,
    queryFn: () => api.getProviderStatus(),
    staleTime: 30_000,
  });
  useEffect(
    () =>
      ws.subscribe((event) => {
        if (event.type === "provider.status") {
          qc.setQueryData<ProviderStatusResponse>(providerKey, event.status);
        }
      }),
    [ws, qc],
  );
  return { ...query, recheck: () => query.refetch() };
}
