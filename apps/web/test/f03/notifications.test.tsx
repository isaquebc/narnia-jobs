import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "../router-helpers";
import { notification } from "./fixtures";
import { shellApi } from "./shell-api";

describe("F03/M4 · sino de pendências no cabeçalho", () => {
  it("mostra a contagem de não resolvidas e leva à página de pendências", async () => {
    const listNotifications = vi.fn(async () => ({
      notifications: [notification(), notification({ id: "n2", kind: "review.conflicts" })],
      unresolved: 2,
    }));
    renderApp({ api: { ...shellApi, listNotifications }, initialUrl: "/dashboard" });
    const bell = await screen.findByRole("link", { name: "Notificações (2)" });
    expect(bell).toHaveAttribute("href", "/pendencias");
    expect(within(bell).getByTestId("notifications-count")).toHaveTextContent("2");
  });

  it("sem pendências, o sino não mostra contador", async () => {
    renderApp({
      api: {
        ...shellApi,
        listNotifications: async () => ({ notifications: [], unresolved: 0 }),
      },
      initialUrl: "/dashboard",
    });
    const bell = await screen.findByRole("link", { name: "Notificações" });
    expect(within(bell).queryByTestId("notifications-count")).toBeNull();
  });

  it("o WS atualiza o contador quando uma pendência nasce", async () => {
    let count = 0;
    const listNotifications = vi.fn(async () => ({
      notifications: Array.from({ length: count }, (_, i) => notification({ id: `n${i}` })),
      unresolved: count,
    }));
    const { ws } = renderApp({ api: { ...shellApi, listNotifications }, initialUrl: "/dashboard" });
    await screen.findByRole("link", { name: "Notificações" });
    count = 1;
    ws.emit({ type: "notification.created", notification: notification() });
    expect(await screen.findByRole("link", { name: "Notificações (1)" })).toBeInTheDocument();
  });
});

describe("F03/M4 · página de pendências (/pendencias)", () => {
  it("lista as abertas agrupadas por tipo, com ir para resolver, marcar lida e dispensar", async () => {
    const listNotifications = vi.fn(async (status?: string) => ({
      notifications:
        status === "resolved"
          ? [notification({ id: "n9", resolvedAt: "2026-10-09T13:00:00.000Z" })]
          : [
              notification(),
              notification({
                id: "n2",
                kind: "ingestion.awaiting_decision",
                title: "Orçamento esgotado: GitHub (3 repositórios)",
                severity: "warning",
              }),
            ],
      unresolved: 2,
    }));
    const readNotification = vi.fn(async () => ({ notification: notification() }));
    const dismissNotification = vi.fn(async () => ({ notification: notification() }));
    renderApp({
      api: { ...shellApi, listNotifications, readNotification, dismissNotification },
      initialUrl: "/pendencias",
    });
    expect(await screen.findByRole("heading", { name: "Pendências" })).toBeInTheDocument();
    const reviews = await screen.findByRole("list", { name: "Revisões pendentes" });
    const decisions = screen.getByRole("list", { name: "Aguardando sua decisão" });
    expect(within(reviews).getAllByRole("listitem")).toHaveLength(1);
    expect(within(decisions).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Revisões pendentes" })).toBeInTheDocument();
    const first = within(reviews).getByRole("listitem", {
      name: "Revisão pendente: GitHub (3 repositórios)",
    });
    expect(within(first).getByRole("link", { name: "Ir para resolver" })).toHaveAttribute(
      "href",
      "/ingestao/r1",
    );
    expect(within(first).getByText("09/10/2026 09:00")).toBeInTheDocument();
    await userEvent.click(within(first).getByRole("button", { name: "Marcar como lida" }));
    expect(readNotification).toHaveBeenCalledWith("n1");
    await userEvent.click(within(first).getByRole("button", { name: "Dispensar" }));
    expect(dismissNotification).toHaveBeenCalledWith("n1");
    await userEvent.click(screen.getByRole("tab", { name: "Resolvidas" }));
    await waitFor(() => expect(listNotifications).toHaveBeenCalledWith("resolved"));
    expect(await screen.findByText(/Resolvida em/)).toBeInTheDocument();
  });

  it("estado vazio", async () => {
    renderApp({
      api: {
        ...shellApi,
        listNotifications: async () => ({ notifications: [], unresolved: 0 }),
      },
      initialUrl: "/pendencias",
    });
    expect(await screen.findByText("Nada pendente. Tudo em dia.")).toBeInTheDocument();
  });

  it("o menu lateral tem Ingestão, Evidências e Configurações", async () => {
    renderApp({
      api: {
        ...shellApi,
        listNotifications: async () => ({ notifications: [], unresolved: 0 }),
      },
      initialUrl: "/pendencias",
    });
    await screen.findByRole("heading", { name: "Pendências" });
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("link", { name: "Ingestão" })).toHaveAttribute(
      "href",
      "/ingestao",
    );
    expect(within(nav).getByRole("link", { name: "Evidências" })).toHaveAttribute(
      "href",
      "/evidencias/repositorios",
    );
    expect(within(nav).getByRole("link", { name: "Configurações" })).toHaveAttribute(
      "href",
      "/configuracoes",
    );
  });
});

describe("CM-3 web · ir para resolver marca a pendência como vista", () => {
  it("clicar em 'Ir para resolver' chama a marcação de lida", async () => {
    const readNotification = vi.fn(async () => ({ notification: notification() }));
    renderApp({
      api: {
        ...shellApi,
        listNotifications: vi.fn(async () => ({ notifications: [notification()], unresolved: 1 })),
        readNotification,
        dismissNotification: vi.fn(),
      },
      initialUrl: "/pendencias",
    });
    const link = await screen.findByRole("link", { name: "Ir para resolver" });
    await userEvent.click(link);
    expect(readNotification).toHaveBeenCalledWith("n1");
  });
});
