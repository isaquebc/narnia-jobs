import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { githubAuth, ingestSettings } from "../f03/fixtures";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";

/**
 * F07/M7 · Configurações › Google Calendar (opcional): status, passo a passo com o cliente OAuth próprio e os comandos;
 * sem conexão a agenda usa o link e o .ics.
 */
const status = (s: string) => ({
  status: s,
  detail: null,
  mcpUrl: "https://calendarmcp.googleapis.com/mcp/v1",
  callbackPort: 8089,
  redirectUri: "http://localhost:8089/callback",
  steps: {
    add: "claude mcp add --transport http google-calendar https://calendarmcp.googleapis.com/mcp/v1 --client-id <SEU_CLIENT_ID> --client-secret --callback-port 8089 --scope user",
    login: "claude mcp login google-calendar",
  },
});

const api = (s: string) => ({
  ...shellApi,
  listNotifications: async () => ({ notifications: [], unresolved: 0 }),
  getIngestSettings: async () => ingestSettings(),
  getGithubAuth: async () => githubAuth(),
  listSnapshots: async () => ({ snapshots: [], totalBytes: 0, maxBytes: 2 * 1024 ** 3 }),
  getBackupSettings: async () => ({ max: 5, enabled: false, latest: null, count: 0 }),
  getGoogleCalendarStatus: vi.fn(async () => status(s)),
});

describe("F07/M7 · Google Calendar em Configurações", () => {
  it("não conectado: guia com o redirect, os comandos e o aviso de que o link e o .ics já funcionam", async () => {
    const a = api("not_configured");
    renderApp({ api: a as never, initialUrl: "/configuracoes" });
    const card = await screen.findByRole("region", { name: "Google Calendar (opcional)" });
    expect(await within(card).findByText("Não conectado")).toBeInTheDocument();
    expect(within(card).getByText(/link e o \.ics/)).toBeInTheDocument();
    const steps = within(card).getByRole("list", { name: "Como conectar" });
    expect(within(steps).getByText("http://localhost:8089/callback")).toBeInTheDocument();
    expect(within(steps).getByText(/start\.sh google connect/)).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Verificar de novo" }));
    expect(a.getGoogleCalendarStatus).toHaveBeenLastCalledWith(true);
  });

  it("conectado", async () => {
    renderApp({ api: api("connected") as never, initialUrl: "/configuracoes" });
    const card = await screen.findByRole("region", { name: "Google Calendar (opcional)" });
    expect(await within(card).findByText("Conectado")).toBeInTheDocument();
  });
});
