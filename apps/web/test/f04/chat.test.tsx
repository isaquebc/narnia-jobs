import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/lib/api";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";
import { message, session } from "./fixtures";

function chatApi(overrides: Record<string, unknown> = {}) {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    listIngestions: async () => ({ runs: [] }),
    listChatSessions: vi.fn(async () => ({ sessions: [session("s1", { title: "Carreira" })] })),
    getChatSession: vi.fn(async (id: string) => ({ session: session(id, { title: "Carreira" }) })),
    listChatMessages: vi.fn(async () => ({ messages: [] })),
    sendChatMessage: vi.fn(async () => ({ turnIndex: 0 })),
    interruptChat: vi.fn(async () => ({ ok: true })),
    hibernateChat: vi.fn(async (id: string) => ({ session: session(id, { state: "hibernated" }) })),
    createChatSession: vi.fn(async () => ({ session: session("s9", { title: "Nova conversa" }) })),
    patchChatSession: vi.fn(async (id: string, p: Record<string, unknown>) => ({
      session: session(id, p),
    })),
    listResearch: vi.fn(async () => ({ sources: [] })),
    getProfileCard: vi.fn(async (id: string) => ({
      profileId: id,
      text: "Ana Maria Exemplo · Campinas",
      tokensEst: 10,
      hash: "h",
      factsVersion: 1,
      builtAt: "2026-10-11T12:00:00.000Z",
      valid: true,
    })),
    ...overrides,
  };
}

describe("F04/M4 · chat com o recrutador", () => {
  it("o menu tem Chat no grupo Geral (recrutador global, F06-8)", async () => {
    renderApp({ api: chatApi(), initialUrl: "/dashboard" });
    const group = await screen.findByRole("group", { name: "Geral" });
    // com conversa ativa o nome acessível ganha o selo ("Chat 1 ativa")
    expect(await within(group).findByRole("link", { name: /^Chat/ })).toHaveAttribute(
      "href",
      "/chat",
    );
  });

  it("envia, mostra a resposta em stream, o chip da ferramenta, o uso do turno, e bloqueia o envio durante o turno", async () => {
    const api = chatApi();
    const { ws } = renderApp({ api, initialUrl: "/chat/s1" });
    const box = await screen.findByRole("textbox", { name: "Mensagem para o recrutador" });
    await userEvent.type(box, "o que está fraco?");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(api.sendChatMessage).toHaveBeenCalledWith("s1", "o que está fraco?");
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
    act(() => {
      ws.emit({
        type: "chat.tool",
        sessionId: "s1",
        name: "evidence_experience_list",
        phase: "start",
      });
      ws.emit({
        type: "chat.tool",
        sessionId: "s1",
        name: "evidence_experience_list",
        phase: "end",
        durationMs: 120,
      });
      ws.emit({ type: "chat.delta", sessionId: "s1", text: "Sua liderança " });
      ws.emit({ type: "chat.delta", sessionId: "s1", text: "**não tem métrica**." });
      ws.emit({ type: "chat.delta", sessionId: "other", text: "não é desta conversa" });
    });
    const list = screen.getByRole("list", { name: "Mensagens" });
    expect(await within(list).findByText("evidence_experience_list")).toBeInTheDocument();
    expect(screen.getByText("não tem métrica")).toBeInTheDocument();
    expect(screen.queryByText("não é desta conversa")).toBeNull();
    act(() =>
      ws.emit({
        type: "chat.turn_end",
        sessionId: "s1",
        turnIndex: 0,
        usage: { inputTokens: 1290, outputTokens: 41 },
      }),
    );
    await userEvent.type(box, "e agora?");
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar" })).not.toBeDisabled());
    expect(screen.getByTestId("session-usage")).toHaveTextContent("1.3k");
  });

  it("parar durante o turno chama interrupt", async () => {
    const api = chatApi();
    renderApp({ api, initialUrl: "/chat/s1" });
    await userEvent.type(
      await screen.findByRole("textbox", { name: "Mensagem para o recrutador" }),
      "oi",
    );
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await userEvent.click(screen.getByRole("button", { name: "Parar" }));
    expect(api.interruptChat).toHaveBeenCalledWith("s1");
  });

  it("histórico mostra mensagens, chips de ferramenta e a nota de cartão atualizado", async () => {
    renderApp({
      api: chatApi({
        listChatMessages: async () => ({
          messages: [
            message("m1", { role: "user", contentMd: "oi" }),
            message("m2", { role: "system_note", contentMd: "Cartão do perfil atualizado" }),
            message("m3", {
              contentMd: "Olá!",
              toolCalls: [{ name: "profile_get_card", args: "{}", durationMs: 30, isError: false }],
            }),
          ],
        }),
      }),
      initialUrl: "/chat/s1",
    });
    expect(await screen.findByText("Olá!")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Mensagens" });
    expect(within(list).getByText("Cartão do perfil atualizado")).toBeInTheDocument();
    expect(within(list).getByText("profile_get_card")).toBeInTheDocument();
  });

  it("teto de 5 conversas: pergunta qual encerrar, hiberna a escolhida e cria a nova", async () => {
    const live = [1, 2, 3, 4, 5].map((i) => session(`s${i}`, { title: `Conversa ${i}` }));
    let first = true;
    const api = chatApi({
      listChatSessions: async () => ({ sessions: live }),
      createChatSession: vi.fn(async () => {
        if (first) {
          first = false;
          throw new ApiError(409, "session_limit", "Limite de conversas", { max: 5, live });
        }
        return { session: session("s6", { title: "Nova conversa" }) };
      }),
    });
    renderApp({ api, initialUrl: "/chat/s1" });
    await userEvent.click(await screen.findByRole("button", { name: "Nova conversa" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Você tem 5 conversas abertas. Qual encerrar?",
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Encerrar Conversa 3" }));
    await waitFor(() => expect(api.hibernateChat).toHaveBeenCalledWith("s3"));
    await waitFor(() => expect(api.createChatSession).toHaveBeenCalledTimes(2));
  });

  it("sessão hibernada avisa que acorda na próxima mensagem", async () => {
    renderApp({
      api: chatApi({
        getChatSession: async (id: string) => ({ session: session(id, { state: "hibernated" }) }),
      }),
      initialUrl: "/chat/s1",
    });
    expect(await screen.findByText(/Conversa hibernada: ela acorda/)).toBeInTheDocument();
  });

  it("erro do provider aparece com mensagem amigável e detalhes técnicos recolhidos", async () => {
    const { ws } = renderApp({ api: chatApi(), initialUrl: "/chat/s1" });
    await screen.findByRole("textbox", { name: "Mensagem para o recrutador" });
    act(() =>
      ws.emit({
        type: "chat.error",
        sessionId: "s1",
        error: "Reached maximum number of turns (8)",
        errorKey: "error.model_format",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/modelo/i);
    expect(screen.getByText("Detalhes técnicos")).toBeInTheDocument();
  });

  it("login expirado: mensagem em pt-BR com como refazer o login, não o texto cru em inglês", async () => {
    const { ws } = renderApp({ api: chatApi(), initialUrl: "/chat/s1" });
    await screen.findByRole("textbox", { name: "Mensagem para o recrutador" });
    act(() =>
      ws.emit({
        type: "chat.error",
        sessionId: "s1",
        error: "Failed to authenticate: OAuth session expired and could not be refreshed",
        errorKey: "error.auth_expired",
      }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/login da assinatura expirou/i);
    expect(alert).toHaveTextContent("./start.sh login");
    expect(alert).toHaveTextContent("claude setup-token");
  });

  it("mensagens rolam dentro do próprio quadro e a lista desce sozinha a cada mensagem nova", async () => {
    const { ws } = renderApp({ api: chatApi(), initialUrl: "/chat/s1" });
    const list = await screen.findByRole("list", { name: "Mensagens" });
    const scroller = list.parentElement as HTMLElement;
    expect(scroller.className).toMatch(/overflow-y-auto/);
    expect(scroller.className).toMatch(/min-h-0/);
    expect(scroller.className).toMatch(/flex-1/);
    let top = 0;
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => 900 });
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (v: number) => {
        top = v;
      },
    });
    act(() => ws.emit({ type: "chat.delta", sessionId: "s1", text: "resposta longa" }));
    await waitFor(() => expect(top).toBe(900));
  });

  it("provider deslogado: mostra como entrar e não cria conversa", async () => {
    const api = chatApi({
      listChatSessions: async () => ({ sessions: [] }),
      getProviderStatus: async () => ({
        installed: true,
        loggedIn: false,
        authMethod: null,
        version: "1",
        loginHint: "rode ./start.sh login",
      }),
    });
    renderApp({ api, initialUrl: "/chat" });
    expect(await screen.findByText(/start\.sh login/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nova conversa" })).toBeDisabled();
  });

  it("execução criada pela conversa aparece como link para a revisão", async () => {
    const { ws } = renderApp({ api: chatApi(), initialUrl: "/chat/s1" });
    await userEvent.type(
      await screen.findByRole("textbox", { name: "Mensagem para o recrutador" }),
      "segue meu texto",
    );
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    // auditoria D: o link vem da tool de ingestão desta conversa (`chat.ingestion_created`), não de qualquer execução
    act(() => ws.emit({ type: "chat.ingestion_created", sessionId: "s1", runId: "r1" }));
    expect(await screen.findByRole("link", { name: "Abrir a ingestão criada" })).toHaveAttribute(
      "href",
      "/ingestao/r1",
    );
  });
});

describe("Regressão 2026-10-11 (e2e F04/E2E-05) · painel Contexto mostra só o cartão do perfil", () => {
  it("usa o cartão do perfil ativo (F02), nunca o prompt completo do recrutador com persona e regras", async () => {
    const getActiveProfileCard = vi.fn(async () => ({
      profileId: "p1",
      cardHash: "h",
      text: "# Recrutador narnia-jobs ... ## Regras 1. Honestidade",
    }));
    const api = chatApi({ getActiveProfileCard });
    renderApp({ api, initialUrl: "/chat/s1" });
    const aside = await screen.findByRole("complementary", { name: "Contexto" });
    expect(await within(aside).findByText("Ana Maria Exemplo · Campinas")).toBeInTheDocument();
    expect(aside).not.toHaveTextContent("## Regras");
    expect(getActiveProfileCard).not.toHaveBeenCalled();
  });
});

describe("Auditoria pós-F04 · bloco A · painel Contexto usa o perfil da conversa", () => {
  it("com outro perfil ativo, o cartão e as fontes são os do perfil da sessão", async () => {
    const getProfileCard = vi.fn(async (id: string) => ({
      profileId: id,
      text: id === "p2" ? "Cartão do perfil da conversa" : "Cartão do perfil ativo",
      tokensEst: 10,
      hash: "h",
      factsVersion: 1,
      builtAt: "2026-10-11T12:00:00.000Z",
      valid: true,
    }));
    const listResearch = vi.fn(async () => ({ sources: [] }));
    const api = chatApi({
      getProfileCard,
      listResearch,
      getChatSession: vi.fn(async (id: string) => ({ session: session(id, { profileId: "p2" }) })),
    });
    renderApp({ api, initialUrl: "/chat/s1" });
    const aside = await screen.findByRole("complementary", { name: "Contexto" });
    expect(await within(aside).findByText("Cartão do perfil da conversa")).toBeInTheDocument();
    expect(aside).not.toHaveTextContent("Cartão do perfil ativo");
    // recrutador global (F06-8): as fontes pesquisadas são de todas as conversas, filtradas pela sessão
    await waitFor(() => expect(listResearch).toHaveBeenCalledWith(null));
  });
});
