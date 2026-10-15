import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/lib/api";
import { profile } from "../components/profile-fixture";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";
import { message, session } from "./fixtures";

/**
 * Auditoria pós-F04 · bloco D (2026-10-12): estado do turno derivado da sessão (`busy`), envio que falha, link da
 * ingestão criada pela própria conversa, painel de contexto por conversa, troca de perfil, paginação do histórico e
 * mudança de categoria.
 */
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

const box = () => screen.findByRole("textbox", { name: "Mensagem para o recrutador" });
const usage = { inputTokens: 10, outputTokens: 5 };

describe("auditoria D · estado do turno", () => {
  it("reload no meio do turno: busy da sessão mostra 'Parar', bloqueia o envio e o fim do turno não duplica a resposta", async () => {
    let busy = true;
    let msgs = [message("u0", { role: "user", contentMd: "pergunta" })];
    const api = chatApi({
      getChatSession: vi.fn(async (id: string) => ({ session: session(id, { busy }) })),
      listChatMessages: vi.fn(async () => ({ messages: msgs })),
    });
    const { ws } = renderApp({ api, initialUrl: "/chat/s1" });
    expect(await screen.findByRole("button", { name: "Parar" })).toBeInTheDocument();
    await userEvent.type(await box(), "outra");
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
    act(() => ws.emit({ type: "chat.delta", sessionId: "s1", text: "Resposta completa" }));
    expect(await screen.findByText("Resposta completa")).toBeInTheDocument();
    busy = false;
    msgs = [...msgs, message("a0", { contentMd: "Resposta completa" })];
    act(() => ws.emit({ type: "chat.turn_end", sessionId: "s1", turnIndex: 0, usage }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Parar" })).toBeNull());
    await waitFor(() => expect(screen.getAllByText("Resposta completa")).toHaveLength(1));
  });

  it("sessão hibernada no meio do turno (session_updated) encerra o 'pensando'", async () => {
    const api = chatApi();
    const { ws } = renderApp({ api, initialUrl: "/chat/s1" });
    await userEvent.type(await box(), "oi");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(screen.getByRole("button", { name: "Parar" })).toBeInTheDocument();
    act(() => ws.emit({ type: "chat.session_updated", sessionId: "s1", state: "hibernated" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Parar" })).toBeNull());
  });

  it("turno interrompido encerra o 'pensando' e recarrega o histórico com a parcial marcada", async () => {
    let msgs: ReturnType<typeof message>[] = [];
    const api = chatApi({ listChatMessages: vi.fn(async () => ({ messages: msgs })) });
    const { ws } = renderApp({ api, initialUrl: "/chat/s1" });
    await userEvent.type(await box(), "conte tudo");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    act(() => ws.emit({ type: "chat.delta", sessionId: "s1", text: "Começo" }));
    msgs = [
      message("u0", { role: "user", contentMd: "conte tudo" }),
      message("a0", { contentMd: "Começo\n\n_(resposta interrompida)_" }),
    ];
    act(() =>
      ws.emit({ type: "chat.turn_end", sessionId: "s1", turnIndex: 0, usage, interrupted: true }),
    );
    expect(await screen.findByText(/resposta interrompida/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Parar" })).toBeNull());
    expect(screen.getAllByText(/Começo/)).toHaveLength(1);
  });
});

describe("auditoria D · envio que falha", () => {
  it("erro no envio devolve o texto ao campo e tira a bolha provisória", async () => {
    const api = chatApi({
      sendChatMessage: vi.fn(async () => {
        throw new ApiError(409, "turn_in_progress", "Turno em andamento");
      }),
    });
    renderApp({ api, initialUrl: "/chat/s1" });
    await userEvent.type(await box(), "minha pergunta");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/ainda está respondendo/i);
    expect(await box()).toHaveValue("minha pergunta");
    const list = screen.getByRole("list", { name: "Mensagens" });
    expect(within(list).queryByText("minha pergunta")).toBeNull();
  });

  it("orçamento esgotado no envio: mensagem amigável", async () => {
    const api = chatApi({
      sendChatMessage: vi.fn(async () => {
        throw new ApiError(409, "budget_exhausted", "Teto de custo atingido");
      }),
    });
    renderApp({ api, initialUrl: "/chat/s1" });
    await userEvent.type(await box(), "oi");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/teto de custo/i);
  });

  it("teto de conversas no envio (conversa hibernada): pergunta qual encerrar e reenvia a mensagem", async () => {
    const live = [2, 3, 4, 5, 6].map((i) => session(`s${i}`, { title: `Conversa ${i}` }));
    let first = true;
    const api = chatApi({
      getChatSession: vi.fn(async (id: string) => ({
        session: session(id, { title: "Carreira", state: "hibernated" }),
      })),
      sendChatMessage: vi.fn(async () => {
        if (first) {
          first = false;
          throw new ApiError(409, "session_limit", "Limite de conversas", { max: 5, live });
        }
        return { turnIndex: 0 };
      }),
    });
    renderApp({ api, initialUrl: "/chat/s1" });
    await userEvent.type(await box(), "voltei");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Você tem 5 conversas abertas. Qual encerrar?",
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Encerrar Conversa 3" }));
    await waitFor(() => expect(api.hibernateChat).toHaveBeenCalledWith("s3"));
    await waitFor(() => expect(api.sendChatMessage).toHaveBeenCalledTimes(2));
    expect(api.sendChatMessage).toHaveBeenLastCalledWith("s1", "voltei");
  });
});

describe("auditoria D · ingestão criada pela conversa", () => {
  it("só chat.ingestion_created da conversa vira link; ingestion.updated de outra execução não", async () => {
    const { ws } = renderApp({ api: chatApi(), initialUrl: "/chat/s1" });
    await userEvent.type(await box(), "registre");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    act(() => ws.emit({ type: "ingestion.updated", runId: "01OUTRA", status: "running" }));
    act(() =>
      ws.emit({ type: "chat.ingestion_created", sessionId: "s2", runId: "01DEOUTRASESSAO" }),
    );
    expect(screen.queryByRole("link", { name: "Abrir a ingestão criada" })).toBeNull();
    act(() => ws.emit({ type: "chat.ingestion_created", sessionId: "s1", runId: "01MINHA" }));
    expect(await screen.findByRole("link", { name: "Abrir a ingestão criada" })).toHaveAttribute(
      "href",
      "/ingestao/01MINHA",
    );
  });

  it("o link vem do histórico (runId gravado na tool call) e sobrevive ao reload", async () => {
    const api = chatApi({
      listChatMessages: vi.fn(async () => ({
        messages: [
          message("a0", {
            contentMd: "Registrei.",
            toolCalls: [
              { name: "ingest_text", args: "{}", durationMs: 5, isError: false, runId: "01SALVA" },
            ],
          }),
        ],
      })),
    });
    renderApp({ api, initialUrl: "/chat/s1" });
    expect(await screen.findByRole("link", { name: "Abrir a ingestão criada" })).toHaveAttribute(
      "href",
      "/ingestao/01SALVA",
    );
  });
});

describe("auditoria D · painel, perfil, histórico e categoria", () => {
  it("painel Contexto: ferramentas usadas só da conversa aberta", async () => {
    const api = chatApi({
      listChatSessions: vi.fn(async () => ({
        sessions: [session("s1", { title: "Um" }), session("s2", { title: "Dois" })],
      })),
    });
    const { ws } = renderApp({ api, initialUrl: "/chat/s1" });
    await userEvent.type(await box(), "oi");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    act(() => ws.emit({ type: "chat.tool", sessionId: "s1", name: "fact_search", phase: "start" }));
    const panel = await screen.findByRole("complementary", { name: "Contexto" });
    expect(await within(panel).findByText("fact_search")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: /Dois/ }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("complementary", { name: "Contexto" })).queryByText("fact_search"),
      ).toBeNull(),
    );
  });

  it("recrutador global (F06-8): trocar o perfil ativo não fecha a conversa aberta", async () => {
    let active = "p1";
    const api = chatApi({
      listProfiles: async () => ({
        profiles: [
          profile("p1", { isActive: active === "p1", name: "Eng" }),
          profile("p2", { isActive: active === "p2", name: "Líder" }),
        ],
      }),
      listChatSessions: vi.fn(async (pid: string | null) => ({
        sessions:
          pid === "p2"
            ? [session("s7", { profileId: "p2", title: "Da liderança" })]
            : [session("s1", { title: "Carreira" })],
      })),
      getChatSession: vi.fn(async (id: string) => ({
        session:
          id === "s7"
            ? session("s7", { profileId: "p2", title: "Da liderança" })
            : session(id, { title: "Carreira" }),
      })),
    });
    const { ws, router } = renderApp({ api, initialUrl: "/chat/s1" });
    await box();
    await screen.findByRole("group", { name: "Eng" });
    active = "p2";
    act(() => ws.emit({ type: "profile.switched", profileId: "p2" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(router.state.location.pathname).toBe("/chat/s1");
  });

  it("'Carregar anteriores' pagina com before e mantém as mensagens já carregadas", async () => {
    const page = Array.from({ length: 50 }, (_, i) =>
      message(`m${i + 10}`, { role: "assistant", contentMd: `recente ${i}`, turnIndex: i + 10 }),
    );
    const older = [message("m1", { role: "assistant", contentMd: "bem antiga", turnIndex: 1 })];
    const list = vi.fn(async (_id: string, opts: { before?: string } = {}) => ({
      messages: opts.before ? older : page,
    }));
    renderApp({ api: chatApi({ listChatMessages: list }), initialUrl: "/chat/s1" });
    await userEvent.click(await screen.findByRole("button", { name: "Carregar anteriores" }));
    expect(await screen.findByText("bem antiga")).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith("s1", expect.objectContaining({ before: "m10" }));
    expect(screen.getByText("recente 49")).toBeInTheDocument();
    // a página antiga veio incompleta: não há mais o que carregar
    expect(screen.queryByRole("button", { name: "Carregar anteriores" })).toBeNull();
  });

  it("histórico curto não oferece 'Carregar anteriores'", async () => {
    renderApp({
      api: chatApi({
        listChatMessages: async () => ({ messages: [message("m1", { contentMd: "oi" })] }),
      }),
      initialUrl: "/chat/s1",
    });
    await screen.findByText("oi");
    expect(screen.queryByRole("button", { name: "Carregar anteriores" })).toBeNull();
  });

  it("mudança de categoria (session_updated com category) atualiza o cabeçalho da conversa", async () => {
    let category: "career" | "ingest" = "career";
    const api = chatApi({
      getChatSession: vi.fn(async (id: string) => ({ session: session(id, { category }) })),
    });
    const { ws } = renderApp({ api, initialUrl: "/chat/s1" });
    const section = await screen.findByRole("region", { name: "Conversa s1" });
    expect(await within(section).findByText("Carreira")).toBeInTheDocument();
    category = "ingest";
    act(() =>
      ws.emit({ type: "chat.session_updated", sessionId: "s1", state: "live", category: "ingest" }),
    );
    expect(await within(section).findByText("Ingestão")).toBeInTheDocument();
  });
});
