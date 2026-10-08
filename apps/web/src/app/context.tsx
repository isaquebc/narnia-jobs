import { createContext, type ReactNode, useContext } from "react";
import type { ApiClient } from "../lib/api";
import type { WsClient } from "../lib/ws";

export interface AppServices {
  api: ApiClient;
  ws: WsClient;
  /** Fuso do usuário (IANA); antes do onboarding, o do navegador. */
  getTimezone: () => string;
}

const AppContext = createContext<AppServices | null>(null);

export function AppProvider({
  services,
  children,
}: {
  services: AppServices;
  children: ReactNode;
}) {
  return <AppContext.Provider value={services}>{children}</AppContext.Provider>;
}

export function useServices(): AppServices {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppProvider ausente");
  return ctx;
}

export const useApi = () => useServices().api;
export const useWs = () => useServices().ws;
export const useTimezone = () => useServices().getTimezone();
