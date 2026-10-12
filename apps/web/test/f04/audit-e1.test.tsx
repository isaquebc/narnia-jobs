import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { githubAuth, ingestSettings } from "../f03/fixtures";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";
import { message, session } from "./fixtures";

/**
 * Auditoria pós-F04 · bloco E1 (lacunas do plano no chat): anexo no composer (§1.4/§4), confirmação da ingestão aberta
 * pela conversa (§7), custo e teto no rodapé, "Continuar" no limite de turnos (§2.5), selo das fontes (§4) e
 * Configurações › Chat (teto de custo) e › Modo plugin.
 */
const chatSettings = {
  maxLiveSessions: 5,
  hibernateAfterMin: 60,
  maxTurns: 8,
  defaultModel: "sonnet",
  maxBudgetUsd: 1 as number | null,
  requireTrustedResearch: true,
};

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
    listResearch: vi.fn(async () => ({ sources: [] })),
    getChatSettings: vi.fn(async () => ({ settings: chatSettings })),
    uploadFile: vi.fn(async (f: File) => ({ id: "f-123", originalName: f.name })) as never,
    getIngestion: vi.fn(async (id: string) => ({
      id,
      status: "awaiting_confirmation",
      estimate: { documentTokens: 0, factsTokens: 9000, digestTokens: 3000 },
      jobs: [],
      proposals: [],
    })) as never,
    confirmIngestion: vi.fn(async () => ({ status: "queued" as const })),
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

describe("auditoria E1 · composer com anexo", () => {
  it("anexa um arquivo: sobe pelo /api/files e envia a mensagem com o anexo para o recrutador ingerir", async () => {
    const api = chatApi();
    renderApp({ api, initialUrl: "/chat/s1" });
    const input = await screen.findByLabelText("Anexar arquivo");
    await userEvent.upload(input, new File(["%PDF"], "cv final.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(api.uploadFile).toHaveBeenCalled());
    await waitFor(() =>
      expect(api.sendChatMessage).toHaveBeenCalledWith(
        "s1",
        expect.stringContaining("[anexo: cv final.pdf · fileId f-123]"),
      ),
    );
  });

  it("recusa tipo que a ingestão não aceita, sem subir nada", async () => {
    const api = chatApi();
    renderApp({ api, initialUrl: "/chat/s1" });
    const input = await screen.findByLabelText("Anexar arquivo");
    await userEvent.upload(input, new File(["x"], "foto.png", { type: "image/png" }), {
      applyAccept: false,
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(api.uploadFile).not.toHaveBeenCalled();
  });

  it("a bolha do usuário mostra o anexo como chip, sem o marcador cru", async () => {
    const api = chatApi({
      listChatMessages: vi.fn(async () => ({
        messages: [
          message("u1", {
            role: "user",
            contentMd: "[anexo: cv final.pdf · fileId f-123]\nlê isso",
          }),
        ],
      })),
    });
    renderApp({ api, initialUrl: "/chat/s1" });
    const list = await screen.findByRole("list", { name: "Mensagens" });
    expect(await within(list).findByText("cv final.pdf")).toBeInTheDocument();
    expect(within(list).queryByText(/fileId/)).toBeNull();
    expect(within(list).getByText("lê isso")).toBeInTheDocument();
  });
});

describe("auditoria E1 · ingestão aberta pela conversa", () => {
  it("acima do limite: mostra a estimativa e confirma pela própria conversa", async () => {
    const api = chatApi({
      listChatMessages: vi.fn(async () => ({
        messages: [
          message("a1", {
            contentMd: "Abri a ingestão; confirma o custo?",
            toolCalls: [
              { name: "ingest_text", args: "{}", durationMs: 5, isError: false, runId: "r1" },
            ],
          }),
        ],
      })),
    });
    renderApp({ api, initialUrl: "/chat/s1" });
    expect(await screen.findByText(/Aguardando sua confirmação/)).toHaveTextContent("12k");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar ingestão" }));
    await waitFor(() => expect(api.confirmIngestion).toHaveBeenCalledWith("r1"));
  });
});

describe("auditoria E1 · rodapé e limite de turnos", () => {
  it("rodapé mostra o custo equivalente da conversa e o teto", async () => {
    const api = chatApi({
      getChatSession: vi.fn(async (id: string) => ({
        session: session(id, { costUsdEst: 0.12, tokensIn: 1000, tokensOut: 200 }),
      })),
    });
    renderApp({ api, initialUrl: "/chat/s1" });
    const usage = await screen.findByTestId("session-usage");
    await waitFor(() => expect(usage).toHaveTextContent(/US\$\s?0,12/));
    expect(usage).toHaveTextContent(/teto US\$\s?1,00/);
  });

  it("limite de turnos: 'Continuar' manda o recrutador seguir de onde parou", async () => {
    const api = chatApi();
    const { ws } = renderApp({ api, initialUrl: "/chat/s1" });
    await screen.findByRole("textbox", { name: "Mensagem para o recrutador" });
    act(() => ws.emit({ type: "chat.limit", sessionId: "s1", reason: "max_turns" }));
    await userEvent.click(await screen.findByRole("button", { name: "Continuar" }));
    await waitFor(() =>
      expect(api.sendChatMessage).toHaveBeenCalledWith("s1", "Continue de onde parou."),
    );
  });
});

describe("auditoria E1 · fontes no painel Contexto", () => {
  it("mostra selo de confiança, trecho, se foi aceita e se o usuário confirmou a fonte", async () => {
    const src = (id: string, p: Record<string, unknown>) => ({
      id,
      profileId: "p1",
      sessionId: "s1",
      url: `https://${id}.exemplo.com/x`,
      domain: `${id}.exemplo.com`,
      title: `Fonte ${id}`,
      excerpt: `Trecho ${id}`,
      usedFor: "salary",
      trustTag: "official",
      userConfirmed: false,
      accepted: null,
      accessedAt: "2026-10-11T12:00:00.000Z",
      ...p,
    });
    const api = chatApi({
      listResearch: vi.fn(async () => ({
        // fontes de teste com o formato da api
        sources: [
          src("a", { accepted: true }),
          src("b", { trustTag: "other", userConfirmed: true }),
        ],
      })),
    });
    renderApp({ api, initialUrl: "/chat/s1" });
    const panel = await screen.findByRole("complementary", { name: "Contexto" });
    expect(await within(panel).findByText("Trecho a")).toBeInTheDocument();
    expect(within(panel).getByText("Oficial")).toBeInTheDocument();
    expect(within(panel).getByText("Valor aceito")).toBeInTheDocument();
    expect(within(panel).getByText("Confirmada por você")).toBeInTheDocument();
  });
});

describe("auditoria E1 · fontes atualizadas ao fim do turno", () => {
  it("o fim do turno relê as fontes (research_save/research_apply mudam o selo sem recarregar a página)", async () => {
    const api = chatApi();
    const { ws } = renderApp({ api, initialUrl: "/chat/s1" });
    await screen.findByRole("complementary", { name: "Contexto" });
    await waitFor(() => expect(api.listResearch).toHaveBeenCalled());
    const before = api.listResearch.mock.calls.length;
    act(() =>
      ws.emit({
        type: "chat.turn_end",
        sessionId: "s1",
        turnIndex: 0,
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    );
    await waitFor(() => expect(api.listResearch.mock.calls.length).toBeGreaterThan(before));
  });
});

describe("auditoria E1 · Configurações", () => {
  const settingsApi = (overrides: Record<string, unknown> = {}) => ({
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    getIngestSettings: async () => ingestSettings(),
    getGithubAuth: async () => githubAuth(),
    listSnapshots: async () => ({ snapshots: [], totalBytes: 0, maxBytes: 2 * 1024 ** 3 }),
    getBackupSettings: async () => ({ max: 5, enabled: false, latest: null, count: 0 }),
    getChatSettings: vi.fn(async () => ({ settings: { ...chatSettings, maxBudgetUsd: null } })),
    putChatSettings: vi.fn(async (p: Record<string, unknown>) => ({
      settings: { ...chatSettings, ...p },
    })),
    listTrustedDomains: vi.fn(async () => ({ domains: [] })),
    getPluginStatus: vi.fn(async () => ({
      mcpUrl: "http://127.0.0.1:3100/mcp",
      mcp: { ok: true, tools: 34 },
      command: "./start.sh install-plugin",
      doctorCommand: "./start.sh doctor",
      lastSeenAt: null,
    })),
    ...overrides,
  });

  it("Chat: teto de custo por conversa (vazio = sem teto)", async () => {
    const api = settingsApi();
    renderApp({ api, initialUrl: "/configuracoes" });
    const budget = await screen.findByLabelText("Teto de custo por conversa (US$)");
    expect(budget).toHaveValue(null);
    await userEvent.type(budget, "2.5");
    await userEvent.click(screen.getByRole("button", { name: "Salvar preferências do chat" }));
    await waitFor(() =>
      expect(api.putChatSettings).toHaveBeenCalledWith(
        expect.objectContaining({ maxBudgetUsd: 2.5 }),
      ),
    );
    await userEvent.clear(budget);
    await userEvent.click(screen.getByRole("button", { name: "Salvar preferências do chat" }));
    await waitFor(() =>
      expect(api.putChatSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ maxBudgetUsd: null }),
      ),
    );
  });

  it("Modo plugin: estado do MCP, URL, comando e o último uso no terminal", async () => {
    const api = settingsApi();
    renderApp({ api, initialUrl: "/configuracoes" });
    const section = await screen.findByRole("region", { name: "Modo plugin (terminal)" });
    expect(await within(section).findByText("http://127.0.0.1:3100/mcp")).toBeInTheDocument();
    expect(within(section).getByText("./start.sh install-plugin")).toBeInTheDocument();
    expect(within(section).getByText(/34 ferramentas/)).toBeInTheDocument();
    expect(within(section).getByText(/Nenhum uso pelo terminal ainda/)).toBeInTheDocument();
  });
});
