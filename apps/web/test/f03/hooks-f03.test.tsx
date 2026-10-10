import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppProvider, type AppServices } from "../../src/app/context";
import { stageLabel } from "../../src/components/shell/ActivityTray";
import { useGithubAuth } from "../../src/hooks/useGithubAuth";
import { useIngestion } from "../../src/hooks/useIngestion";
import { useNotifications } from "../../src/hooks/useNotifications";
import { createFakeApi, createFakeWs } from "../helpers";
import { githubAuth, notification, run } from "./fixtures";

function setup(api: Parameters<typeof createFakeApi>[0]) {
  const ws = createFakeWs();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 60_000, staleTime: 60_000 } },
  });
  const services: AppServices = {
    api: createFakeApi(api),
    ws,
    getTimezone: () => "America/Sao_Paulo",
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AppProvider services={services}>{children}</AppProvider>
    </QueryClientProvider>
  );
  return { ws, queryClient, wrapper };
}

describe("F03/M4 · bandeja: rótulos das etapas novas", () => {
  it("traduz reconciliação, conferência, tarefas do GitHub e análise de perfis", () => {
    expect(stageLabel("ingest.reconcile")).toBe("Comparação com os seus dados");
    expect(stageLabel("ingest.review_check")).toBe("Conferência das evidências");
    expect(stageLabel("ingest.github.prepare")).toBe("Preparação da análise do GitHub");
    expect(stageLabel("ingest.github.pick")).toBe("Escolha dos arquivos a ler");
    expect(stageLabel("ingest.github.repo")).toBe("Análise do repositório");
    expect(stageLabel("ingest.github.synthesis")).toBe("Síntese da análise do GitHub");
    expect(stageLabel("profile.analyze")).toBe("Análise de possíveis perfis");
    expect(stageLabel("stalled")).toBe("Reprocessando");
    expect(stageLabel("etapa.desconhecida")).toBe("etapa.desconhecida");
  });
});

describe("F03/M4 · useNotifications", () => {
  it("carrega as abertas com a contagem e recarrega a cada notification.created/updated", async () => {
    const listNotifications = vi.fn(async () => ({
      notifications: [notification()],
      unresolved: 1,
    }));
    const { wrapper, ws } = setup({ listNotifications });
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.unresolved).toBe(1));
    expect(result.current.notifications).toHaveLength(1);
    expect(listNotifications).toHaveBeenCalledWith("open");
    ws.emit({ type: "notification.created", notification: notification({ id: "n2" }) });
    await waitFor(() => expect(listNotifications).toHaveBeenCalledTimes(2));
    ws.emit({
      type: "notification.updated",
      notification: notification({ resolvedAt: "2026-10-09T13:00:00.000Z" }),
    });
    await waitFor(() => expect(listNotifications).toHaveBeenCalledTimes(3));
  });

  it("marcar lida e dispensar chamam a API e recarregam", async () => {
    const listNotifications = vi.fn(async () => ({
      notifications: [notification()],
      unresolved: 1,
    }));
    const readNotification = vi.fn(async () => ({ notification: notification() }));
    const dismissNotification = vi.fn(async () => ({ notification: notification() }));
    const { wrapper } = setup({ listNotifications, readNotification, dismissNotification });
    const { result } = renderHook(() => useNotifications("all"), { wrapper });
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    await result.current.markRead.mutateAsync("n1");
    await result.current.dismiss.mutateAsync("n1");
    expect(readNotification).toHaveBeenCalledWith("n1");
    expect(dismissNotification).toHaveBeenCalledWith("n1");
    await waitFor(() => expect(listNotifications.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(listNotifications).toHaveBeenCalledWith("all");
  });
});

describe("F03/M4 · useGithubAuth", () => {
  it("lê o status e aplica github.auth_updated do WS", async () => {
    const getGithubAuth = vi.fn(async () => githubAuth({ connected: false, login: null }));
    const { wrapper, ws } = setup({ getGithubAuth });
    const { result } = renderHook(() => useGithubAuth(), { wrapper });
    await waitFor(() => expect(result.current.data?.connected).toBe(false));
    ws.emit({
      type: "github.auth_updated",
      status: githubAuth({ source: "app", connected: true, login: "ana-exemplo" }),
    });
    await waitFor(() => expect(result.current.data?.login).toBe("ana-exemplo"));
    expect(result.current.data?.source).toBe("app");
  });
});

describe("F03/M4 · useIngestion", () => {
  it("ingestion.updated da execução recarrega o detalhe", async () => {
    const getIngestion = vi.fn(async () => run());
    const { wrapper, ws } = setup({ getIngestion });
    const { result } = renderHook(() => useIngestion("r1"), { wrapper });
    await waitFor(() => expect(result.current.data?.id).toBe("r1"));
    ws.emit({ type: "ingestion.updated", runId: "outra", status: "running" });
    ws.emit({ type: "ingestion.updated", runId: "r1", status: "awaiting_decision" });
    await waitFor(() => expect(getIngestion).toHaveBeenCalledTimes(2));
  });
});
