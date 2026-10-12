import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";
import { session } from "./fixtures";

/**
 * Auditoria pós-F04 · bloco E2 (18a) · passo 6 do primeiro uso, "Entrevista de descoberta" (o passo 7 do fluxo de
 * 02-fluxos; "Mais fontes" não existe no wizard): opcional, pulável, reaproveita o chat (L2) dentro do wizard e só
 * conclui o primeiro uso ao sair dele. O menu continua só com "Primeiro uso" até lá.
 */
function api(overrides: Record<string, unknown> = {}) {
  const state = { step: 6, completed: false };
  return {
    ...shellApi,
    getOnboardingState: vi.fn(async () => ({ ...state })),
    putOnboardingState: vi.fn(async (s: typeof state) => {
      Object.assign(state, s);
      return { ...state };
    }),
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    listIngestions: async () => ({ runs: [] }),
    listChatSessions: vi.fn(async () => ({ sessions: [] })),
    createChatSession: vi.fn(async () => ({
      session: session("d1", { category: "discovery", title: "Entrevista de descoberta" }),
    })),
    getChatSession: vi.fn(async (id: string) => ({
      session: {
        ...session(id, { category: "discovery", title: "Entrevista de descoberta" }),
        busy: false,
      },
    })),
    listChatMessages: vi.fn(async () => ({ messages: [] })),
    sendChatMessage: vi.fn(async () => ({ turnIndex: 0 })),
    listResearch: async () => ({ sources: [] }),
    getChatSettings: async () => ({
      settings: {
        maxLiveSessions: 5,
        hibernateAfterMin: 60,
        maxTurns: 8,
        defaultModel: "sonnet",
        maxBudgetUsd: null,
        requireTrustedResearch: true,
      },
    }),
    getDashboard: async () =>
      ({
        profile: null,
        counts: { experiences: 0, skills: 0, education: 0, files: 0, projects: 0 },
        usage: { totalTokens: 0, byCategory: {} },
        pendingResearch: 0,
        card: null,
        emphasis: { highlighted: 0, hidden: 0 },
        suggestions: 0,
      }) as never,
    ...overrides,
  };
}

describe("auditoria E2 · entrevista de descoberta no primeiro uso", () => {
  it("passo 6 de 6, opcional: pular conclui o primeiro uso e abre o dashboard sem criar conversa", async () => {
    const a = api();
    renderApp({ api: a, initialUrl: "/onboarding/6" });
    expect(await screen.findByText("Passo 6 de 6")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Entrevista de descoberta" })).toBeInTheDocument();
    // o menu ainda só oferece o primeiro uso
    expect(screen.getByRole("navigation").textContent).not.toMatch(/Dashboard/);
    await userEvent.click(screen.getByRole("button", { name: "Pular e ir ao dashboard" }));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(a.putOnboardingState).toHaveBeenCalledWith(expect.objectContaining({ completed: true }));
    expect(a.createChatSession).not.toHaveBeenCalled();
  });

  it("começar cria a conversa de descoberta, manda a abertura e mostra o chat dentro do wizard", async () => {
    const a = api();
    const sessions: unknown[] = [];
    a.listChatSessions.mockImplementation(async () => ({ sessions }) as never);
    a.createChatSession.mockImplementation(async () => {
      const s = session("d1", { category: "discovery", title: "Entrevista de descoberta" });
      sessions.push(s);
      return { session: s };
    });
    renderApp({ api: a, initialUrl: "/onboarding/6" });
    await userEvent.click(await screen.findByRole("button", { name: "Começar entrevista" }));
    await waitFor(() =>
      expect(a.createChatSession).toHaveBeenCalledWith(
        expect.objectContaining({ category: "discovery", title: "Entrevista de descoberta" }),
      ),
    );
    await waitFor(() =>
      expect(a.sendChatMessage).toHaveBeenCalledWith(
        "d1",
        "Vamos começar a entrevista de descoberta.",
      ),
    );
    expect(
      await screen.findByRole("textbox", { name: "Mensagem para o recrutador" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Concluir e ir ao dashboard" }));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("voltar ao passo 6 com a entrevista já começada retoma a mesma conversa, sem criar outra", async () => {
    const a = api({
      listChatSessions: vi.fn(async () => ({
        sessions: [session("d7", { category: "discovery", title: "Entrevista de descoberta" })],
      })),
    });
    renderApp({ api: a, initialUrl: "/onboarding/6" });
    expect(
      await screen.findByRole("textbox", { name: "Mensagem para o recrutador" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(a.getChatSession).toHaveBeenCalledWith("d7"));
    expect(a.createChatSession).not.toHaveBeenCalled();
  });
});
