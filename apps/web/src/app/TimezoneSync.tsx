import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useApi } from "./context";
import { setUserTimezone } from "./timezone";

/** Mantém o fuso do usuário (do banco) disponível para `getTimezone()`; antes disso vale o do navegador. */
export function TimezoneSync() {
  const api = useApi();
  const user = useQuery({ queryKey: ["user"], queryFn: () => api.getUser(), staleTime: 60_000 });
  useEffect(() => {
    setUserTimezone(user.data?.user?.timezone ?? null);
  }, [user.data]);
  return null;
}
