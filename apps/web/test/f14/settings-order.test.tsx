import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { githubAuth, ingestSettings } from "../f03/fixtures";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";

/**
 * F14/M1 · RT-I5: ordem dos cartões de Configurações; a F14 acrescenta o do Gmail logo depois do Google Calendar,
 * sem mudar o resto.
 */
const api = {
  ...shellApi,
  listNotifications: async () => ({ notifications: [], unresolved: 0 }),
  getIngestSettings: async () => ingestSettings(),
  getGithubAuth: async () => githubAuth(),
  listSnapshots: async () => ({ snapshots: [], totalBytes: 0, maxBytes: 2 * 1024 ** 3 }),
  getBackupSettings: async () => ({ max: 5, enabled: false, latest: null, count: 0 }),
  getGmailStatus: async () => ({
    status: "not_configured",
    email: null,
    connectedAt: null,
    clientSource: null,
    clientIdHint: null,
    reason: null,
    connecting: false,
    lastError: null,
    callbackPort: 8089,
    redirectUri: "http://localhost:8089/callback",
  }),
  getGoogleCalendarStatus: vi.fn(async () => ({
    status: "not_configured",
    detail: null,
    mcpUrl: "",
    callbackPort: 8089,
    redirectUri: "http://localhost:8089/callback",
    steps: { add: "", login: "" },
  })),
};

describe("F14/M1 · RT-I5 · Configurações", () => {
  it("títulos dos cartões na ordem de hoje", async () => {
    renderApp({ api: api as never, initialUrl: "/configuracoes" });
    await screen.findByRole("region", { name: "Google Calendar (opcional)" });
    for (const name of [
      "Conexão com o GitHub",
      "Gmail (opcional)",
      "Avaliações (Phoenix)",
      "Ingestão",
      "Snapshots",
      "Backups",
    ])
      await screen.findByRole("heading", { name });
    const names = [...document.querySelectorAll("h2, h3")].map((h) => h.textContent);
    expect(names).toEqual([
      "Integrações",
      "Conexão com o GitHub",
      "Chat",
      "Termos aprendidos pela busca",
      "Busca por sentido",
      "Modelos de currículo",
      "Processos simultâneos",
      "Modo plugin (terminal)",
      "Extensão do navegador",
      "Google Calendar (opcional)",
      "Gmail (opcional)",
      "Análise de vídeo (opcional)",
      "Avaliações (Phoenix)",
      "Ingestão",
      "Snapshots",
      "Backups",
    ]);
  });
});
