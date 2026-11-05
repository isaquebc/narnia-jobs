import "./styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider, type AppServices } from "./app/context";
import { createAppRouter } from "./app/router";
import { TimezoneSync } from "./app/TimezoneSync";
import { currentTimezone } from "./app/timezone";
import { createApiClient } from "./lib/api";
import { applyTheme, resolveInitialTheme, safeLocalStorage, systemPrefersDark } from "./lib/theme";
import { enterUrl, loadToken, readTokenFromSearch, saveToken } from "./lib/token";
import { createWsClient, resyncOnReconnect } from "./lib/ws";

applyTheme(
  document.documentElement,
  resolveInitialTheme(safeLocalStorage(), systemPrefersDark()),
  safeLocalStorage(),
);

// Token de boot (F01-7): `?token=` → cookie via /api/auth/enter (o servidor redireciona para "/").
const urlToken = readTokenFromSearch(window.location.search);
if (urlToken) {
  saveToken(urlToken);
  window.location.replace(enterUrl(urlToken));
} else {
  const api = createApiClient({ getToken: () => loadToken() });
  const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws${
    loadToken() ? `?token=${encodeURIComponent(loadToken() as string)}` : ""
  }`;
  const ws = createWsClient({ url: wsUrl });
  const services: AppServices = { api, ws, getTimezone: currentTimezone };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
  });
  resyncOnReconnect(ws, queryClient);
  const router = createAppRouter({ services, queryClient });

  const root = document.getElementById("root");
  if (!root) throw new Error("Elemento #root não encontrado");
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AppProvider services={services}>
          <TimezoneSync />
          <RouterProvider router={router} />
        </AppProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
