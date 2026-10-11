import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { profile } from "../../components/profile-fixture";
import { renderApp } from "../../router-helpers";

const baseApi = {
  getOnboardingState: async () => ({ step: 5, completed: true }),
  listJobs: async () => ({ jobs: [] }),
  getProviderStatus: async () => ({
    installed: true,
    loggedIn: true,
    authMethod: "claude.ai" as const,
    version: "1",
    loginHint: null,
  }),
  listProfiles: async () => ({ profiles: [profile("p1", { isActive: true, name: "Eng" })] }),
  listSuggestions: async () => ({ suggestions: [] }),
  getUser: async () => ({ user: null }),
};

describe("rotas de perfis (F02 §4)", () => {
  it("/perfis renderiza a lista e o menu lateral tem 'Perfis'", async () => {
    renderApp({ api: baseApi, initialUrl: "/perfis" });
    expect(await screen.findByRole("heading", { name: "Perfis" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Perfis" })).toHaveAttribute("href", "/perfis");
  });

  it("/perfis/novo renderiza o título do novo perfil", async () => {
    renderApp({
      api: {
        ...baseApi,
        getSalaryReference: async () => ({ reference: null }),
      },
      initialUrl: "/perfis/novo",
    });
    expect(await screen.findByRole("heading", { name: "Novo perfil" })).toBeInTheDocument();
  });
});
