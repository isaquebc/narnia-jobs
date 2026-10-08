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

  it("passo 4 salva a identidade e invalida a query do usuário (cache de 5 s da app)", async () => {
    let saved: Record<string, unknown> | null = null;
    const getUser = vi.fn(async () => ({ user: saved }) as never);
    const putUser = vi.fn(async (body: Record<string, unknown>) => {
      saved = { ...body, id: "u1" };
      return saved as never;
    });
    renderApp({
      staleTime: 60_000,
      api: {
        getOnboardingState: async () => ({ step: 4, completed: false }),
        putOnboardingState: async (s) => s,
        getProviderStatus: async () => loggedIn,
        listJobs: async () => ({ jobs: [] }),
        listProfiles: async () => ({ profiles: [] }),
        getUser,
        putUser,
        getProfileSuggestion: async () =>
          ({ targetTitle: "", altTitles: [], seniority: null, area: "", reasons: [] }) as never,
        getSalaryReference: async () => ({ reference: null }),
      },
      initialUrl: "/onboarding/4",
    });
    await screen.findByText("Passo 4 de 5");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Nome de exibição/), "Bia");
    await user.type(screen.getByLabelText(/Nome completo/), "Beatriz Exemplo");
    await user.type(screen.getByLabelText(/E-mail de contato/), "bia@example.com");
    await user.type(screen.getByLabelText("DDD"), "41");
    await user.type(screen.getByLabelText("Número"), "999990000");
    await user.type(screen.getByLabelText(/Cidade/), "Curitiba");
    await user.click(screen.getByRole("button", { name: "Avançar" }));
    expect(await screen.findByText("Passo 5 de 5")).toBeInTheDocument();
    await waitFor(() => expect(putUser).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getUser.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("passo 5 cria o perfil e o shell passa a mostrar o perfil ativo (cache de 5 s da app)", async () => {
    const profiles: Array<Record<string, unknown>> = [];
    const createProfile = vi.fn(async (body: Record<string, unknown>) => {
      const p = { ...body, id: "p1", userId: "u1", isActive: true, salaryBelowReference: false };
      profiles.push(p);
      return p as never;
    });
    renderApp({
      staleTime: 60_000,
      api: {
        getOnboardingState: async () => ({ step: 5, completed: false }),
        putOnboardingState: async (s) => s,
        getProviderStatus: async () => loggedIn,
        listJobs: async () => ({ jobs: [] }),
        listProfiles: async () => ({ profiles }) as never,
        getUser: async () =>
          ({
            user: { id: "u1", displayName: "Bia", country: "BR", timezone: "America/Sao_Paulo" },
          }) as never,
        getProfileSuggestion: async () =>
          ({ targetTitle: "", altTitles: [], seniority: null, area: "", reasons: [] }) as never,
        getSalaryReference: async () => ({ reference: null }),
        createProfile,
        getDashboard: async () =>
          ({
            profile: profiles[0] ?? null,
            counts: { experiences: 0, skills: 0, education: 0, files: 0 },
            usage: { totalTokens: 0, byCategory: {} },
            pendingResearch: 0,
          }) as never,
      },
      initialUrl: "/onboarding/5",
    });
    await screen.findByText("Passo 5 de 5");
    expect(await screen.findByText("Sem perfil ainda")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Nome do perfil/), "Analista de dados");
    await user.type(screen.getByLabelText(/Cargo-alvo/), "Analista de Dados");
    await user.type(screen.getByLabelText(/Área/), "dados");
    await user.type(screen.getByLabelText("Mínimo"), "9000");
    await user.type(screen.getByLabelText("Máximo"), "12000");
    await user.click(screen.getByLabelText("CLT"));
    await user.click(screen.getByRole("button", { name: "Criar perfil e ir ao dashboard" }));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    await waitFor(() => expect(createProfile).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Analista de dados", { selector: "span" })).toBeInTheDocument();
    expect(await screen.findByText("Olá, Bia")).toBeInTheDocument();
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
