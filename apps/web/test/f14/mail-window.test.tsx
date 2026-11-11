import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MailWindow } from "../../src/features/settings/MailWindow";
import { renderWithProviders } from "../helpers";

/** F14/M2 · primeira leitura do Gmail: escolher quanto tempo para trás ler; depois, o resumo do que foi lido. */
const counts = {
  pending: 3,
  processing: 0,
  done: 5,
  review: 0,
  quarantine: 0,
  ignored: 2,
  error: 0,
};

describe("F14/M2 · janela da primeira leitura", () => {
  it("sem janela: 30 dias marcado; escolher 90 grava a data de 90 dias atrás", async () => {
    const putMailSettings = vi.fn(async (since: string) => ({ since, lastSyncAt: null, counts }));
    renderWithProviders(<MailWindow />, {
      api: {
        getMailSettings: async () => ({ since: null, lastSyncAt: null, counts }),
        putMailSettings,
      } as never,
    });
    expect(await screen.findByRole("radio", { name: "Últimos 30 dias" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Últimos 90 dias" }));
    await userEvent.click(screen.getByRole("button", { name: "Começar a ler" }));
    await waitFor(() => expect(putMailSettings).toHaveBeenCalled());
    const since = Date.parse(putMailSettings.mock.calls[0]?.[0] as string);
    expect(Math.round((Date.now() - since) / 86_400_000)).toBe(90);
    expect(await screen.findByText(/Lendo desde/)).toBeInTheDocument();
  });

  it("desde uma data: o botão espera a data", async () => {
    renderWithProviders(<MailWindow />, {
      api: { getMailSettings: async () => ({ since: null, lastSyncAt: null, counts }) } as never,
    });
    await userEvent.click(await screen.findByRole("radio", { name: "Desde uma data" }));
    expect(screen.getByRole("button", { name: "Começar a ler" })).toBeDisabled();
  });

  it("com janela: resumo do que foi lido e o link para as execuções", async () => {
    renderWithProviders(<MailWindow />, {
      api: {
        getMailSettings: async () => ({
          since: "2026-10-12T00:00:00.000Z",
          lastSyncAt: "2026-11-11T12:00:00.000Z",
          counts,
        }),
      } as never,
    });
    expect(
      await screen.findByText("10 e-mail(s) lidos, 3 aguardando processamento."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Tarefas agendadas/ })).toHaveAttribute(
      "href",
      "/processos",
    );
    expect(screen.getByRole("button", { name: "Ler mais para trás" })).toBeInTheDocument();
  });
});
