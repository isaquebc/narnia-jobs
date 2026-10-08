import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Shell } from "../../src/components/shell/Shell";
import { renderWithProviders } from "../helpers";

describe("Shell · L0 mínimo", () => {
  it("mostra 'sem perfil', fuso do usuário, estado da conexão e alterna o tema", async () => {
    const { ws } = renderWithProviders(
      <Shell>
        <p>conteúdo</p>
      </Shell>,
      {
        api: {
          listJobs: async () => ({ jobs: [] }),
          getProviderStatus: async () => ({
            installed: true,
            loggedIn: true,
            authMethod: "claude.ai",
            version: "1",
            loginHint: null,
          }),
          listProfiles: async () => ({ profiles: [] }),
        },
        timezone: "Europe/Lisbon",
      },
    );
    expect(await screen.findByText("Sem perfil ainda")).toBeInTheDocument();
    expect(screen.getByText("Fuso horário: Europe/Lisbon")).toBeInTheDocument();
    expect(screen.getByText("Conectado")).toBeInTheDocument();
    ws.setStatus("reconnecting");
    expect(await screen.findByText("Reconectando…")).toBeInTheDocument();
    const root = document.documentElement;
    root.classList.remove("dark");
    await userEvent.click(screen.getByRole("button", { name: "Alternar tema" }));
    expect(root.classList.contains("dark")).toBe(true);
    expect(screen.getByText("conteúdo")).toBeInTheDocument();
  });
});
