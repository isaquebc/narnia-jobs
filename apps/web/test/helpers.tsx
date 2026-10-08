import type { WsEvent } from "@narnia-jobs/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderOptions, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { AppProvider, type AppServices } from "../src/app/context";
import type { ApiClient } from "../src/lib/api";
import type { WsClient, WsStatus } from "../src/lib/ws";

export function createFakeWs() {
  const listeners = new Set<(e: WsEvent) => void>();
  const statusListeners = new Set<(s: WsStatus) => void>();
  let status: WsStatus = "open";
  const ws = {
    connect: () => {},
    close: () => {},
    subscribe: (l: (e: WsEvent) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    onStatus: (l: (s: WsStatus) => void) => {
      statusListeners.add(l);
      l(status);
      return () => statusListeners.delete(l);
    },
    get status() {
      return status;
    },
    emit: (e: WsEvent) => {
      for (const l of listeners) l(e);
    },
    setStatus: (s: WsStatus) => {
      status = s;
      for (const l of statusListeners) l(s);
    },
  };
  return ws as unknown as WsClient & {
    emit: (e: WsEvent) => void;
    setStatus: (s: WsStatus) => void;
  };
}

const notImplemented = (name: string) => () => Promise.reject(new Error(`api.${name} não mockado`));

export function createFakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return notImplemented(prop);
    },
  };
  return new Proxy({ ...overrides } as Record<string, unknown>, handler) as unknown as ApiClient;
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  api?: Partial<ApiClient>;
  ws?: ReturnType<typeof createFakeWs>;
  timezone?: string;
  queryClient?: QueryClient;
}

export function renderWithProviders(ui: ReactElement, opts: RenderWithProvidersOptions = {}) {
  const ws = opts.ws ?? createFakeWs();
  const api = createFakeApi(opts.api);
  const queryClient =
    opts.queryClient ??
    new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
  const services: AppServices = {
    api,
    ws,
    getTimezone: () => opts.timezone ?? "America/Sao_Paulo",
  };
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AppProvider services={services}>{children}</AppProvider>
    </QueryClientProvider>
  );
  return { ...render(ui, { ...opts, wrapper: Wrapper }), ws, api, queryClient };
}

export function job(partial: Partial<import("@narnia-jobs/shared").Job> = {}) {
  return {
    id: "run1__ingest.read_text",
    queue: "ingest" as const,
    type: "ingest.read_text",
    parentId: "run1",
    profileId: null,
    status: "active" as const,
    progress: 20,
    stage: "ingest.read_text",
    payload: {},
    result: null,
    error: null,
    attempts: 1,
    createdAt: "2026-10-07T12:00:00.000Z",
    startedAt: "2026-10-07T12:00:01.000Z",
    finishedAt: null,
    ...partial,
  };
}
