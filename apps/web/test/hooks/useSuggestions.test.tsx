import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppProvider, type AppServices } from "../../src/app/context";
import { useProfiles } from "../../src/hooks/useProfiles";
import { useSuggestions } from "../../src/hooks/useSuggestions";
import { profile } from "../components/profile-fixture";
import { createFakeApi, createFakeWs } from "../helpers";

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

describe("Auditoria F02 (2026-10-08) · useSuggestions (13)", () => {
  it("ativar um perfil não refaz GET /api/profiles/suggestions; profile.switched refaz", async () => {
    const listProfiles = vi.fn(async () => ({
      profiles: [profile("p1", { isActive: true }), profile("p2", { isActive: false })],
    }));
    const activateProfile = vi.fn(async (id: string) => profile(id, { isActive: true }));
    const listSuggestions = vi.fn(async () => ({ suggestions: [] }));
    const { wrapper, ws } = setup({ listProfiles, activateProfile, listSuggestions });
    const { result } = renderHook(() => ({ p: useProfiles(), s: useSuggestions() }), { wrapper });
    await waitFor(() => expect(listSuggestions).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.p.active?.id).toBe("p1"));
    await act(() => result.current.p.activate.mutateAsync("p2"));
    await waitFor(() => expect(listProfiles).toHaveBeenCalledTimes(2));
    expect(listSuggestions).toHaveBeenCalledTimes(1);
    act(() => ws.emit({ type: "profile.switched", profileId: "p2" }));
    await waitFor(() => expect(listSuggestions).toHaveBeenCalledTimes(2));
  });
});
