import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "../router-helpers";

const loggedIn = {
  installed: true,
  loggedIn: true,
  authMethod: "claude.ai" as const,
  version: "1",
  loginHint: null,
};

describe("Wizard · 5 passos, retomada e bloqueio", () => {
  it("retoma no passo salvo e mostra 'Passo 2 de 5'", async () => {
    renderApp({
      api: {
        getOnboardingState: async () => ({ step: 2, completed: false }),
        getProviderStatus: async () => loggedIn,
        listJobs: async () => ({ jobs: [] }),
        listProfiles: async () => ({ profiles: [] }),
      },
      initialUrl: "/",
    });
    expect(await screen.findByText("Passo 2 de 5")).toBeInTheDocument();
    expect(
      screen.getByText("Já tem um currículo pronto? Vamos extrair tudo dele."),
    ).toBeInTheDocument();
  });

  it("onboarding concluído redireciona para o dashboard", async () => {
    renderApp({
      api: {
        getOnboardingState: async () => ({ step: 5, completed: true }),
        getProviderStatus: async () => loggedIn,
        listJobs: async () => ({ jobs: [] }),
        listProfiles: async () => ({ profiles: [] }),
        getDashboard: async () => ({
          profile: null,
          counts: { experiences: 0, skills: 0, education: 0, files: 0 },
          usage: { totalTokens: 0, byCategory: {} },
          pendingResearch: 0,
        }),
        getUser: async () => ({ user: null }),
      },
      initialUrl: "/",
    });
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("passo 1 só avança com provider logado e grava o estado", async () => {
    const putOnboardingState = vi.fn(async (s: unknown) => s as never);
    renderApp({
      api: {
        getOnboardingState: async () => ({ step: 1, completed: false }),
        getProviderStatus: async () => loggedIn,
        putOnboardingState,
        listJobs: async () => ({ jobs: [] }),
        listProfiles: async () => ({ profiles: [] }),
      },
      initialUrl: "/onboarding/1",
    });
    const next = await screen.findByRole("button", { name: "Avançar" });
    await waitFor(() => expect(next).toBeEnabled());
    await userEvent.click(next);
    await waitFor(() =>
      expect(putOnboardingState).toHaveBeenCalledWith(expect.objectContaining({ step: 2 })),
    );
    expect(await screen.findByText("Passo 2 de 5")).toBeInTheDocument();
  });

  it("passo 4 bloqueia com obrigatórios vazios", async () => {
    const putUser = vi.fn();
    renderApp({
      api: {
        getOnboardingState: async () => ({ step: 4, completed: false }),
        getProviderStatus: async () => loggedIn,
        listJobs: async () => ({ jobs: [] }),
        listProfiles: async () => ({ profiles: [] }),
        getUser: async () => ({ user: null }),
        putUser,
      },
      initialUrl: "/onboarding/4",
    });
    await screen.findByText("Passo 4 de 5");
    await userEvent.click(await screen.findByRole("button", { name: "Avançar" }));
    expect(
      await screen.findByText("Preencha os campos obrigatórios para avançar."),
    ).toBeInTheDocument();
    expect(putUser).not.toHaveBeenCalled();
  });

  it("API fora mostra erro acionável", async () => {
    renderApp({
      api: {
        getOnboardingState: async () => {
          const { ApiError } = await import("../../src/lib/api");
          throw new ApiError(0, "network", "Failed to fetch");
        },
        getProviderStatus: async () => loggedIn,
        listJobs: async () => ({ jobs: [] }),
        listProfiles: async () => ({ profiles: [] }),
      },
      initialUrl: "/",
    });
    expect(await screen.findByText("Não foi possível falar com a API local.")).toBeInTheDocument();
  });
});
