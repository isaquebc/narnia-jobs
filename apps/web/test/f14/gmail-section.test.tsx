import type { GmailStatusView } from "@narnia-jobs/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GmailSection } from "../../src/features/settings/GmailSection";
import { renderWithProviders } from "../helpers";

/**
 * F14/M1 · Configurações › Gmail: sem cliente, o formulário com o endereço de retorno (o segredo vai como senha e
 * some depois de salvar); com cliente, conectar abre o login numa aba nova; conectado mostra a conta e desconecta
 * com confirmação; recusa do Google pede reconectar.
 */
const base = {
  email: null,
  connectedAt: null,
  clientSource: null,
  clientIdHint: null,
  reason: null,
  connecting: false,
  lastError: null,
  callbackPort: 8089,
  redirectUri: "http://localhost:8089/callback",
};
const st = (over: object): GmailStatusView =>
  ({ ...base, status: "not_configured", ...over }) as GmailStatusView;

afterEach(() => vi.restoreAllMocks());

describe("F14/M1 · cartão do Gmail", () => {
  it("sem cliente: formulário com o endereço de retorno; salvar manda id e segredo", async () => {
    const putGmailClient = vi.fn(async () =>
      st({ status: "disconnected", clientSource: "settings", clientIdHint: "123…" }),
    );
    renderWithProviders(<GmailSection />, {
      api: { getGmailStatus: async () => st({}), putGmailClient } as never,
    });
    const card = await screen.findByRole("region", { name: "Gmail (opcional)" });
    expect(await within(card).findByText("Sem cliente OAuth")).toBeInTheDocument();
    expect(within(card).getByText("http://localhost:8089/callback")).toBeInTheDocument();
    const secret = within(card).getByLabelText("Client secret");
    expect(secret).toHaveAttribute("type", "password");
    await userEvent.type(
      within(card).getByLabelText("Client ID"),
      "123-abc.apps.googleusercontent.com",
    );
    await userEvent.type(secret, "GOCSPX-x");
    await userEvent.click(within(card).getByRole("button", { name: "Salvar cliente" }));
    await waitFor(() =>
      expect(putGmailClient).toHaveBeenCalledWith({
        clientId: "123-abc.apps.googleusercontent.com",
        clientSecret: "GOCSPX-x",
      }),
    );
    expect(await within(card).findByText("Não conectado")).toBeInTheDocument();
  });

  it("com cliente do .env: conectar abre o login do Google numa aba nova e mostra que está aguardando", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const connectGmail = vi.fn(async () => ({
      ...st({
        status: "disconnected",
        clientSource: "env",
        clientIdHint: "env-id…",
        connecting: true,
      }),
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth?x=1",
    }));
    renderWithProviders(<GmailSection />, {
      api: {
        getGmailStatus: async () =>
          st({ status: "disconnected", clientSource: "env", clientIdHint: "env-id…" }),
        connectGmail,
      } as never,
    });
    const card = await screen.findByRole("region", { name: "Gmail (opcional)" });
    expect(await within(card).findByText("Cliente OAuth do .env (env-id…).")).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Conectar o Gmail" }));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        "https://accounts.google.com/o/oauth2/v2/auth?x=1",
        "_blank",
        "noopener",
      ),
    );
    expect(await within(card).findByText(/Aguardando o login no Google/)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Abrir o login do Google" })).toHaveAttribute(
      "href",
      "https://accounts.google.com/o/oauth2/v2/auth?x=1",
    );
  });

  it("conectado: mostra a conta e desconecta depois de confirmar", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const disconnectGmail = vi.fn(async () =>
      st({ status: "disconnected", clientSource: "env", clientIdHint: "env-id…" }),
    );
    renderWithProviders(<GmailSection />, {
      api: {
        getGmailStatus: async () =>
          st({
            status: "connected",
            email: "pessoa@example.com",
            clientSource: "env",
            clientIdHint: "env-id…",
          }),
        disconnectGmail,
      } as never,
    });
    const card = await screen.findByRole("region", { name: "Gmail (opcional)" });
    expect(await within(card).findByText("Conta: pessoa@example.com")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Conectar o Gmail" })).toBeNull();
    await userEvent.click(within(card).getByRole("button", { name: "Desconectar" }));
    await waitFor(() => expect(disconnectGmail).toHaveBeenCalled());
  });

  it("recusado pelo Google: aviso e botão Conectar de novo", async () => {
    renderWithProviders(<GmailSection />, {
      api: {
        getGmailStatus: async () =>
          st({
            status: "needs_reconnect",
            email: "pessoa@example.com",
            clientSource: "env",
            clientIdHint: "env-id…",
          }),
      } as never,
    });
    const card = await screen.findByRole("region", { name: "Gmail (opcional)" });
    expect(await within(card).findByText("Reconectar")).toBeInTheDocument();
    expect(within(card).getByText(/O Google recusou o acesso/)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Conectar de novo" })).toBeInTheDocument();
  });
});
