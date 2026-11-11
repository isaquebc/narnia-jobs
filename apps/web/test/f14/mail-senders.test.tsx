import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MailSenders } from "../../src/features/settings/MailSenders";
import { renderWithProviders } from "../helpers";

/** F14/M3 · Configurações › Gmail › Remetentes: confiar, bloquear, remover, sugestões e avaliar a quarentena de novo. */
const sender = (
  value: string,
  override: "trusted" | "blocked" | null,
  origin: "manual" | "extension" | null = "manual",
) => ({
  value,
  override,
  overrideOrigin: override ? origin : null,
  seenCount: 3,
  okCount: 3,
  rejectedCount: 0,
  lastSeenAt: null,
});
const view = {
  trusted: [sender("@acme.example", "trusted")],
  blocked: [sender("golpe@fake.example", "blocked", "extension")],
  suggestions: [sender("rh@globex.example", null)],
};

describe("F14/M3 · remetentes", () => {
  it("mostra as listas com a origem e remove", async () => {
    const deleteMailSender = vi.fn(async () => ({ ...view, trusted: [] }));
    renderWithProviders(<MailSenders />, {
      api: { listMailSenders: async () => view, deleteMailSender } as never,
    });
    const trusted = await screen.findByRole("list", { name: "Confiáveis" });
    expect(within(trusted).getByText("@acme.example")).toBeInTheDocument();
    const blocked = screen.getByRole("list", { name: "Bloqueados" });
    expect(within(blocked).getByText("pela extensão")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tirar @acme.example da lista" }));
    await waitFor(() => expect(deleteMailSender).toHaveBeenCalledWith("@acme.example"));
  });

  it("confiar num remetente com quarentena oferece avaliar de novo", async () => {
    const putMailSender = vi.fn(async () => ({ ...view, quarantined: 2 }));
    const reprocessMailSender = vi.fn(async () => ({ reprocessed: 2 }));
    renderWithProviders(<MailSenders />, {
      api: { listMailSenders: async () => view, putMailSender, reprocessMailSender } as never,
    });
    await userEvent.type(await screen.findByLabelText("Endereço ou @domínio"), "@Vitalis.example");
    await userEvent.click(screen.getByRole("button", { name: "Confiar" }));
    await waitFor(() =>
      expect(putMailSender).toHaveBeenCalledWith({
        value: "@Vitalis.example",
        override: "trusted",
      }),
    );
    expect(
      await screen.findByText("2 e-mail(s) deste remetente estão em quarentena."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Avaliar de novo" }));
    await waitFor(() => expect(reprocessMailSender).toHaveBeenCalledWith("@vitalis.example"));
    expect(await screen.findByText("2 e-mail(s) voltaram para a avaliação.")).toBeInTheDocument();
  });

  it("sugestão: confiar com um clique", async () => {
    const putMailSender = vi.fn(async () => ({ ...view, quarantined: 0 }));
    renderWithProviders(<MailSenders />, {
      api: { listMailSenders: async () => view, putMailSender } as never,
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Confiar em rh@globex.example" }),
    );
    await waitFor(() =>
      expect(putMailSender).toHaveBeenCalledWith({
        value: "rh@globex.example",
        override: "trusted",
      }),
    );
  });
});
