import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProviderCard } from "../../src/features/onboarding/components/ProviderCard";
import { renderWithProviders } from "../helpers";

const base = { installed: true, loggedIn: true, version: "2.1.292", loginHint: null };

describe("ProviderCard · 4 estados + verificar", () => {
  it("estado checando", () => {
    renderWithProviders(<ProviderCard />, {
      api: { getProviderStatus: () => new Promise(() => {}) },
    });
    expect(screen.getByText("Verificando o login…")).toBeInTheDocument();
  });

  it("logado por volume e por token", async () => {
    const { unmount } = renderWithProviders(<ProviderCard />, {
      api: { getProviderStatus: async () => ({ ...base, authMethod: "claude.ai" as const }) },
    });
    expect(
      await screen.findByText("Logado pela assinatura (login no container)"),
    ).toBeInTheDocument();
    expect(screen.getByText("versão 2.1.292")).toBeInTheDocument();
    unmount();
    renderWithProviders(<ProviderCard />, {
      api: { getProviderStatus: async () => ({ ...base, authMethod: "oauth_token" as const }) },
    });
    expect(
      await screen.findByText("Logado por token (CLAUDE_CODE_OAUTH_TOKEN)"),
    ).toBeInTheDocument();
  });

  it("não logado mostra os dois caminhos e 'verificar de novo' consulta a API", async () => {
    const statuses = [
      { ...base, loggedIn: false, authMethod: "none" as const, loginHint: "x" },
      { ...base, authMethod: "claude.ai" as const },
    ];
    const last = statuses[1] as (typeof statuses)[number];
    const getProviderStatus = vi.fn(async () => statuses.shift() ?? last);
    renderWithProviders(<ProviderCard />, { api: { getProviderStatus } });
    expect(await screen.findByText("Não logado")).toBeInTheDocument();
    expect(screen.getByText("./start.sh login")).toBeInTheDocument();
    expect(screen.getByText("claude setup-token", { selector: "code" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Verificar de novo" }));
    expect(
      await screen.findByText("Logado pela assinatura (login no container)"),
    ).toBeInTheDocument();
    expect(getProviderStatus).toHaveBeenCalledTimes(2);
  });

  it("erro ao executar o CLI", async () => {
    renderWithProviders(<ProviderCard />, {
      api: {
        getProviderStatus: async () => ({
          installed: false,
          loggedIn: false,
          authMethod: "none" as const,
          version: null,
          loginHint: null,
        }),
      },
    });
    expect(await screen.findByText("CLI não encontrado no container")).toBeInTheDocument();
  });
});
