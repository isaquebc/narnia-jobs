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

  it("ocupa a altura da janela: só o <main> rola, cabeçalho e menu ficam fixos (pedido do dono, 2026-10-12)", async () => {
    renderWithProviders(
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
      },
    );
    const main = await screen.findByRole("main");
    expect(main.className).toMatch(/overflow-auto/);
    expect(main.className).toMatch(/min-h-0/);
    const root = main.closest("div.flex-col") as HTMLElement;
    expect(root.className).toMatch(/\bh-screen\b/);
    expect(root.className).toMatch(/overflow-hidden/);
    expect(main.parentElement?.className).toMatch(/min-h-0/);
  });

  it("cabeçalho com o logo da porta ao lado do nome (decorativo: o nome é o texto)", async () => {
    renderWithProviders(
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
      },
    );
    const header = (await screen.findByText("narnia-jobs")).closest("header") as HTMLElement;
    const logo = header.querySelector("svg[data-logo='narnia-jobs']");
    expect(logo).not.toBeNull();
    expect(logo?.getAttribute("aria-hidden")).toBe("true");
  });
});
