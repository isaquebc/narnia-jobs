import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { AppProvider, type AppServices } from "../src/app/context";
import { createAppRouter } from "../src/app/router";
import type { ApiClient } from "../src/lib/api";
import { createFakeApi, createFakeWs } from "./helpers";

export function renderApp(opts: {
  api?: Partial<ApiClient>;
  initialUrl?: string;
  timezone?: string;
}) {
  const ws = createFakeWs();
  const api = createFakeApi(opts.api);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const services: AppServices = {
    api,
    ws,
    getTimezone: () => opts.timezone ?? "America/Sao_Paulo",
  };
  const router = createAppRouter({
    services,
    queryClient,
    history: createMemoryHistory({ initialEntries: [opts.initialUrl ?? "/"] }),
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AppProvider services={services}>
        <RouterProvider router={router} />
      </AppProvider>
    </QueryClientProvider>,
  );
  return { ...utils, router, ws, api, queryClient };
}
