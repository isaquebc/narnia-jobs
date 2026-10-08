import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppProvider, type AppServices } from "../../src/app/context";
import { useProfileCard } from "../../src/hooks/useProfileCard";
import { useProfiles } from "../../src/hooks/useProfiles";
import { createFakeApi, createFakeWs } from "../helpers";

const profile = (id: string, isActive: boolean, archivedAt: string | null = null) => ({
  id,
  userId: "u1",
  name: id,
  targetTitle: id,
  altTitles: [],
  seniority: "senior" as const,
  area: "software",
  goal: "new_job" as const,
  market: "BR",
  docLocale: "pt-BR",
  salaryBelowReference: false,
  contractTypes: [],
  locations: [],
  needsResearch: [],
  isActive,
  archivedAt,
});

function setup(api: Parameters<typeof createFakeApi>[0]) {
  const ws = createFakeWs();
  const queryClient = new QueryClient({
    // gcTime > 0: a query "dashboard" semeada sem observador não pode ser coletada antes da asserção
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

describe("useProfiles · lista, ativo, ações e WS profile.switched (F02 §2.5)", () => {
  it("expõe o ativo, ativa pela API e invalida perfis e dashboard", async () => {
    const listProfiles = vi.fn(async () => ({
      profiles: [profile("p1", true), profile("p2", false)],
    }));
    const activateProfile = vi.fn(async (id: string) => profile(id, true));
    const { wrapper, queryClient } = setup({ listProfiles, activateProfile });
    queryClient.setQueryData(["dashboard"], { stale: false });
    const { result } = renderHook(() => useProfiles(), { wrapper });
    await waitFor(() => expect(result.current.active?.id).toBe("p1"));
    await act(() => result.current.activate.mutateAsync("p2"));
    expect(activateProfile).toHaveBeenCalledWith("p2");
    await waitFor(() => expect(listProfiles).toHaveBeenCalledTimes(2));
    expect(queryClient.getQueryState(["dashboard"])?.isInvalidated).toBe(true);
  });

  it("profile.switched pelo WS invalida a lista (outra aba trocou)", async () => {
    const listProfiles = vi.fn(async () => ({ profiles: [profile("p1", true)] }));
    const { wrapper, ws } = setup({ listProfiles });
    const { result } = renderHook(() => useProfiles(), { wrapper });
    await waitFor(() => expect(result.current.profiles).toHaveLength(1));
    act(() => ws.emit({ type: "profile.switched", profileId: "p2" }));
    await waitFor(() => expect(listProfiles).toHaveBeenCalledTimes(2));
  });

  it("a lista padrão esconde arquivados; includeArchived pede à API", async () => {
    const listProfiles = vi.fn(async (opts?: { archived?: boolean }) => ({
      profiles: opts?.archived
        ? [profile("p1", true), profile("p3", false, "2026-10-08T00:00:00.000Z")]
        : [profile("p1", true)],
    }));
    const { wrapper } = setup({ listProfiles });
    const { result } = renderHook(() => useProfiles({ includeArchived: true }), { wrapper });
    await waitFor(() => expect(result.current.profiles).toHaveLength(2));
    expect(listProfiles).toHaveBeenCalledWith({ archived: true });
  });
});

describe("useProfileCard · cartão e invalidação pelo WS (F02 §2.2)", () => {
  it("carrega o cartão, reconstrói pelo botão e invalida com profile.card_invalidated", async () => {
    const card = {
      profileId: "p1",
      text: "linha 1\nlinha 2",
      tokensEst: 10,
      hash: "h",
      factsVersion: 3,
      builtAt: "2026-10-08T12:00:00.000Z",
      valid: true,
    };
    const getProfileCard = vi.fn(async () => card);
    const rebuildProfileCard = vi.fn(async () => ({ ...card, hash: "h2" }));
    const { wrapper, ws } = setup({ getProfileCard, rebuildProfileCard });
    const { result } = renderHook(() => useProfileCard("p1"), { wrapper });
    await waitFor(() => expect(result.current.data?.hash).toBe("h"));
    await act(() => result.current.rebuild.mutateAsync());
    await waitFor(() => expect(result.current.data?.hash).toBe("h2"));
    act(() => ws.emit({ type: "profile.card_invalidated", profileIds: ["p9"] }));
    expect(getProfileCard).toHaveBeenCalledTimes(1);
    act(() => ws.emit({ type: "profile.card_invalidated", profileIds: ["p1"] }));
    await waitFor(() => expect(getProfileCard).toHaveBeenCalledTimes(2));
  });
});
