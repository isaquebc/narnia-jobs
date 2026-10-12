import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/lib/api";
import { proposal, run } from "../f03/fixtures";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";
import { session } from "./fixtures";

describe("F04/M4 · clarificar com o recrutador", () => {
  it("o botão da revisão cria a sessão de clarificação e abre o chat com o cabeçalho", async () => {
    const clarifyIngestion = vi.fn(async () => ({
      session: session("c1", { category: "clarify", ingestionRunId: "r1", title: "Clarificação" }),
    }));
    const { router } = renderApp({
      api: {
        ...shellApi,
        listNotifications: async () => ({ notifications: [], unresolved: 0 }),
        listIngestions: async () => ({ runs: [] }),
        getIngestion: async () => run({ status: "review" }),
        clarifyIngestion,
        getChatSession: async () => ({
          session: session("c1", {
            category: "clarify",
            ingestionRunId: "r1",
            title: "Clarificação",
          }),
        }),
        listChatSessions: async () => ({ sessions: [] }),
        listChatMessages: async () => ({ messages: [] }),
        listResearch: async () => ({ sources: [] }),
        getActiveProfileCard: async () => ({ profileId: "p1", cardHash: "h", text: "cartão" }),
      },
      initialUrl: "/ingestao/r1",
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Clarificar com o recrutador" }),
    );
    await waitFor(() => expect(clarifyIngestion).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/chat/c1"));
    expect(await screen.findByText(/Clarificando ingestão/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir para a revisão" })).toHaveAttribute(
      "href",
      "/ingestao/r1",
    );
  });

  it("com 5 conversas abertas, clarificar pergunta qual encerrar e depois abre a clarificação", async () => {
    const live = [1, 2, 3, 4, 5].map((i) => session(`s${i}`, { title: `Conversa ${i}` }));
    let first = true;
    const clarifyIngestion = vi.fn(async () => {
      if (first) {
        first = false;
        throw new ApiError(409, "session_limit", "Limite de conversas", { max: 5, live });
      }
      return { session: session("c1", { category: "clarify", ingestionRunId: "r1" }) };
    });
    const hibernateChat = vi.fn(async (id: string) => ({
      session: session(id, { state: "hibernated" }),
    }));
    const { router } = renderApp({
      api: {
        ...shellApi,
        listNotifications: async () => ({ notifications: [], unresolved: 0 }),
        listIngestions: async () => ({ runs: [] }),
        getIngestion: async () => run({ status: "review" }),
        clarifyIngestion,
        hibernateChat,
        getChatSession: async () => ({
          session: session("c1", { category: "clarify", ingestionRunId: "r1" }),
        }),
        listChatSessions: async () => ({ sessions: [] }),
        listChatMessages: async () => ({ messages: [] }),
        listResearch: async () => ({ sources: [] }),
        getActiveProfileCard: async () => ({ profileId: "p1", cardHash: "h", text: "cartão" }),
      },
      initialUrl: "/ingestao/r1",
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Clarificar com o recrutador" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Você tem 5 conversas abertas. Qual encerrar?",
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Encerrar Conversa 2" }));
    await waitFor(() => expect(hibernateChat).toHaveBeenCalledWith("s2"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/chat/c1"));
  });
});

describe("Regressão 2026-10-11 (e2e F04/E2E-06) · revisão mostra a proposta criada na clarificação", () => {
  it("ingestion.updated recebido no chat invalida a execução; ao voltar pela ligação, a revisão traz a proposta nova", async () => {
    let calls = 0;
    const getIngestion = vi.fn(async () => {
      calls++;
      return run({
        status: "review",
        proposals:
          calls === 1
            ? [proposal("p1")]
            : [
                proposal("p1"),
                proposal("p2", {
                  proposal: {
                    kind: "skill",
                    confidence: 0.7,
                    data: { name: "Comunicação com stakeholders", category: "soft" },
                  },
                }),
              ],
      });
    });
    const { router, ws } = renderApp({
      api: {
        ...shellApi,
        listNotifications: async () => ({ notifications: [], unresolved: 0 }),
        listIngestions: async () => ({ runs: [] }),
        getIngestion,
        getChatSession: async () => ({
          session: session("c1", {
            category: "clarify",
            ingestionRunId: "r1",
            title: "Clarificação",
          }),
        }),
        listChatSessions: async () => ({ sessions: [] }),
        listChatMessages: async () => ({ messages: [] }),
        listResearch: async () => ({ sources: [] }),
      },
      initialUrl: "/ingestao/r1",
      // cache como na app (main.tsx): 5 s de staleTime e queries inativas guardadas
      staleTime: 5_000,
      gcTime: 300_000,
    });
    await screen.findByRole("region", { name: "Revisão" });
    await router.navigate({ to: "/chat/$sessionId", params: { sessionId: "c1" } });
    await screen.findByText(/Clarificando ingestão/);
    ws.emit({ type: "ingestion.updated", runId: "r1", status: "review" });
    await userEvent.click(screen.getByRole("link", { name: "Ir para a revisão" }));
    const review = await screen.findByRole("region", { name: "Revisão" });
    expect(await within(review).findByText(/Comunicação com stakeholders/)).toBeInTheDocument();
  });
});
