import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { githubAuth, ingestSettings } from "../f03/fixtures";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";

/**
 * F12 · tutorial de instalação da extensão do Chrome (F12-8, F12-10): página `/extensao` com os passos (gerar, modo do
 * desenvolvedor, carregar sem compactação, fixar, parear) e o endereço desta instância; Configurações leva até ela.
 */
const api = {
  ...shellApi,
  listNotifications: async () => ({ notifications: [], unresolved: 0 }),
  getIngestSettings: async () => ingestSettings(),
  getGithubAuth: async () => githubAuth(),
  listSnapshots: async () => ({ snapshots: [], totalBytes: 0, maxBytes: 2 * 1024 ** 3 }),
  getBackupSettings: async () => ({ max: 5, enabled: false, latest: null, count: 0 }),
};

describe("F12 · tutorial de instalação da extensão", () => {
  it("Configurações › Extensão do navegador leva ao tutorial", async () => {
    renderApp({ api, initialUrl: "/configuracoes" });
    const card = await screen.findByRole("region", { name: "Extensão do navegador" });
    await userEvent.click(within(card).getByRole("link", { name: "Como instalar no Chrome" }));
    expect(
      await screen.findByRole("heading", { name: "Instalar a extensão no Chrome" }),
    ).toBeInTheDocument();
  });

  it("mostra os passos em ordem, com os comandos, a pasta e o endereço desta instância", async () => {
    renderApp({ api, initialUrl: "/extensao" });
    await screen.findByRole("heading", { name: "Instalar a extensão no Chrome" });
    const steps = within(screen.getByRole("list", { name: "Passos da instalação" })).getAllByRole(
      "listitem",
    );
    expect(steps.map((s) => within(s).getByRole("heading").textContent)).toEqual([
      "Gere a extensão",
      "Abra a página de extensões do Chrome",
      "Ligue o modo do desenvolvedor",
      "Carregue a pasta da extensão",
      "Fixe o ícone na barra",
      "Conecte ao narnia",
    ]);
    expect(within(steps[0] as HTMLElement).getByText("./start.sh extension")).toBeInTheDocument();
    expect(within(steps[0] as HTMLElement).getByText(".\\start.ps1 extension")).toBeInTheDocument();
    expect(within(steps[1] as HTMLElement).getByText("chrome://extensions")).toBeInTheDocument();
    expect(within(steps[3] as HTMLElement).getByText("apps/extension/dist")).toBeInTheDocument();
    expect(within(steps[5] as HTMLElement).getByText(window.location.origin)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Depois de atualizar o narnia" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Se algo der errado" })).toBeInTheDocument();
  });

  it("avisa que a extensão ainda está em construção", async () => {
    renderApp({ api, initialUrl: "/extensao" });
    expect(await screen.findByText(/ainda está em construção/)).toBeInTheDocument();
  });
});
