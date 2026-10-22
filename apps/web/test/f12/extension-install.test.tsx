import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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

  it("avisa que, por enquanto, a extensão só conecta (ler vagas e formulários vem depois)", async () => {
    renderApp({ api, initialUrl: "/extensao" });
    expect(await screen.findByText(/por enquanto, a extensão só se conecta/)).toBeInTheDocument();
  });
});

describe("F12/M1 · Configurações › Extensão do navegador", () => {
  const device = (id: string, name: string, lastSeenAt: string | null = null) => ({
    id,
    name,
    createdAt: "2026-10-22T10:00:00.000Z",
    lastSeenAt,
  });

  it("gera o código de pareamento e mostra com a validade e o endereço da instância", async () => {
    const createExtensionPairing = vi.fn(async () => ({
      code: "K7QM-3XPA",
      expiresAt: "2026-10-22T13:10:00.000Z",
    }));
    renderApp({
      api: { ...api, listExtensionDevices: async () => ({ devices: [] }), createExtensionPairing },
      initialUrl: "/configuracoes",
    });
    const card = await screen.findByRole("region", { name: "Extensão do navegador" });
    expect(await within(card).findByText(/Nenhum navegador conectado/)).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Gerar código de pareamento" }));
    expect(await within(card).findByText("K7QM-3XPA")).toBeInTheDocument();
    expect(within(card).getByText(/vale até 10:10/)).toBeInTheDocument();
    expect(within(card).getByText(window.location.origin)).toBeInTheDocument();
    expect(createExtensionPairing).toHaveBeenCalledTimes(1);
  });

  it("lista os navegadores conectados e desconecta um", async () => {
    let devices = [
      device("d1", "Chrome do notebook", "2026-10-22T12:00:00.000Z"),
      device("d2", "Chrome do trabalho"),
    ];
    const revokeExtensionDevice = vi.fn(async (id: string) => {
      devices = devices.filter((d) => d.id !== id);
    });
    renderApp({
      api: { ...api, listExtensionDevices: async () => ({ devices }), revokeExtensionDevice },
      initialUrl: "/configuracoes",
    });
    const card = await screen.findByRole("region", { name: "Extensão do navegador" });
    const row = (await within(card).findByText("Chrome do notebook")).closest("li") as HTMLElement;
    expect(within(row).getByText(/Último uso: 22\/10\/2026 09:00/)).toBeInTheDocument();
    expect(
      within(within(card).getByText("Chrome do trabalho").closest("li") as HTMLElement).getByText(
        "Ainda não usado",
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      within(row).getByRole("button", { name: "Desconectar Chrome do notebook" }),
    );
    expect(revokeExtensionDevice).toHaveBeenCalledWith("d1");
    await waitFor(() => expect(within(card).queryByText("Chrome do notebook")).toBeNull());
  });
});
