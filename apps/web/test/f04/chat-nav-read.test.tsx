import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";
import { message, session } from "./fixtures";

/**
 * Ajustes do chat (pedido do dono, 2026-10-13): conversas como subitens do Chat no menu (5 recentes + ativas, ponto
 * verde para não lida), título "Recrutador <perfil>", autor "Recrutador <perfil> Sênior", lida só quando a mensagem
 * aparece na tela, link da ingestão no corpo da mensagem e um card por ingestão no painel.
 */

// o jsdom não tem IntersectionObserver: o teste decide quando a última mensagem "aparece"
const observers: Array<{ cb: IntersectionObserverCallback; el: Element | null }> = [];
class FakeObserver {
  el: Element | null = null;
  constructor(readonly cb: IntersectionObserverCallback) {
    observers.push(this as unknown as { cb: IntersectionObserverCallback; el: Element | null });
  }
  observe(el: Element) {
    this.el = el;
  }
  disconnect() {
    this.el = null;
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}
const showLast = (visible: boolean) =>
  act(() => {
    for (const o of observers)
      if (o.el)
        (o as unknown as { cb: IntersectionObserverCallback }).cb(
          [{ isIntersecting: visible, target: o.el } as IntersectionObserverEntry],
          o as unknown as IntersectionObserver,
        );
  });

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(() => vi.unstubAllGlobals());

function chatApi(overrides: Record<string, unknown> = {}) {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    listIngestions: async () => ({ runs: [] }),
    listChatSessions: vi.fn(async () => ({ sessions: [session("s1", { title: "Carreira" })] })),
    getChatSession: vi.fn(async (id: string) => ({ session: session(id, { title: "Carreira" }) })),
    listChatMessages: vi.fn(async () => ({ messages: [] })),
    sendChatMessage: vi.fn(async () => ({ turnIndex: 0 })),
    markChatRead: vi.fn(async (id: string) => ({ session: session(id, { unread: 0 }) })),
    patchChatSession: vi.fn(async (id: string, p: Record<string, unknown>) => ({
      session: session(id, p),
    })),
    listResearch: vi.fn(async () => ({ sources: [] })),
    getChatSettings: vi.fn(async () => ({ settings: { maxBudgetUsd: null } })),
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

describe("menu: conversas como subitens do Chat", () => {
  const many = [
    ...Array.from({ length: 6 }, (_, i) =>
      session(`h${i}`, { title: `Recente ${i}`, state: "hibernated", unread: i === 0 ? 2 : 0 }),
    ),
    session("live1", { title: "Ativa antiga", state: "live" }),
    session("old", { title: "Bem antiga", state: "hibernated" }),
  ];

  it("5 recentes e todas as ativas; selo com as ativas; ponto verde na não lida; 'Ver todas' expande", async () => {
    renderApp({
      api: chatApi({ listChatSessions: vi.fn(async () => ({ sessions: many })) }) as never,
      initialUrl: "/dashboard",
    });
    const sub = await screen.findByRole("list", { name: "Conversas do chat" });
    const names = () =>
      within(sub)
        .getAllByRole("link")
        .map((a) => a.textContent);
    expect(names()).toEqual([
      "Recente 0",
      "Recente 1",
      "Recente 2",
      "Recente 3",
      "Recente 4",
      "Ativa antiga",
    ]);
    const first = within(sub).getByRole("link", { name: /Recente 0/ });
    expect(within(first).getByRole("img", { name: "mensagem não lida" })).toBeInTheDocument();
    expect(
      within(within(sub).getByRole("link", { name: /Recente 1/ })).queryByRole("img"),
    ).toBeNull();
    expect(screen.getByRole("link", { name: /^Chat/ })).toHaveTextContent("1 ativa");
    await userEvent.click(within(sub).getByRole("button", { name: "Ver todas (8)" }));
    expect(names()).toContain("Bem antiga");
    expect(names()).toContain("Recente 5");
    await userEvent.click(within(sub).getByRole("button", { name: "Ver menos" }));
    expect(names()).not.toContain("Bem antiga");
  });

  it("a conversa aberta não tem mais a fileira de conversas no topo; o título é só 'Recrutador' (2026-10-15)", async () => {
    const api = chatApi({
      listChatSessions: vi.fn(async () => ({
        sessions: [session("s1", { title: "Carreira" }), session("s2", { title: "Outra" })],
      })),
    });
    renderApp({ api: api as never, initialUrl: "/chat/s1" });
    expect(await screen.findByRole("heading", { level: 1, name: "Recrutador" })).toBeVisible();
    expect(await screen.findByRole("heading", { level: 2, name: "Carreira" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Conversas" })).toBeNull();
    // renomear continua na conversa aberta
    await userEvent.click(screen.getByRole("button", { name: "Renomear" }));
    const input = screen.getByRole("textbox", { name: "Novo título da conversa" });
    await userEvent.clear(input);
    await userEvent.type(input, "Promoção{Enter}");
    await waitFor(() =>
      expect(api.patchChatSession).toHaveBeenCalledWith("s1", { title: "Promoção" }),
    );
  });
});

describe("mensagens: autor, leitura e link da ingestão", () => {
  const history = [
    message("u1", { role: "user", contentMd: "registre meu texto" }),
    message("a1", {
      contentMd: "Abri a ingestão do seu texto.",
      toolCalls: [{ name: "ingest_text", args: "{}", durationMs: 5, isError: false, runId: "r1" }],
    }),
    message("a2", {
      contentMd: "Abri outra.",
      toolCalls: [{ name: "ingest_text", args: "{}", durationMs: 5, isError: false, runId: "r2" }],
    }),
  ];

  it("o autor é 'Recrutador <perfil> Sênior' e cada link da ingestão fica na mensagem que a criou", async () => {
    renderApp({
      api: chatApi({
        listChatMessages: vi.fn(async () => ({ messages: history })),
        getIngestion: vi.fn(async (id: string) => ({
          id,
          source: "text",
          fileId: "f1",
          status: id === "r1" ? "done" : "review",
          jobs: [],
          proposals: [],
        })),
      }) as never,
      initialUrl: "/chat/s1",
    });
    const list = await screen.findByRole("list", { name: "Mensagens" });
    const a1 = (await within(list).findByText("Abri a ingestão do seu texto.")).closest("li");
    expect(within(a1 as HTMLElement).getByText("Recrutador Eng Sênior")).toBeInTheDocument();
    expect(
      within(a1 as HTMLElement).getByRole("link", { name: "Abrir a ingestão criada" }),
    ).toHaveAttribute("href", "/ingestao/r1");
    const a2 = within(list).getByText("Abri outra.").closest("li");
    expect(
      within(a2 as HTMLElement).getByRole("link", { name: "Abrir a ingestão criada" }),
    ).toHaveAttribute("href", "/ingestao/r2");
    // fora das mensagens não sobra link fixo acima do campo
    expect(screen.getAllByRole("link", { name: "Abrir a ingestão criada" })).toHaveLength(2);

    // um card por ingestão, a mais nova em cima; a anterior continua, finalizada
    const cards = await screen.findByRole("list", { name: "Ingestões da conversa" });
    await waitFor(() =>
      expect(within(cards).getAllByRole("region", { name: "Ingestão da conversa" })).toHaveLength(
        2,
      ),
    );
    const [newest, older] = within(cards).getAllByRole("listitem");
    expect(
      within(older as HTMLElement).getByRole("link", { name: "Abrir a página da ingestão" }),
    ).toHaveAttribute("href", "/ingestao/r1");
    expect(await within(older as HTMLElement).findByText("Finalizada")).toBeInTheDocument();
    expect(within(newest as HTMLElement).queryByText("Finalizada")).toBeNull();
  });

  it("lida só quando a última mensagem aparece na tela; rolada para fora, não marca", async () => {
    const api = chatApi({
      getChatSession: vi.fn(async (id: string) => ({
        session: session(id, { title: "Carreira", unread: 1 }),
      })),
      listChatMessages: vi.fn(async () => ({ messages: history.slice(0, 2) })),
    });
    renderApp({ api: api as never, initialUrl: "/chat/s1" });
    await screen.findByText("Abri a ingestão do seu texto.");
    await waitFor(() => expect(observers.some((o) => o.el)).toBe(true));
    showLast(false);
    expect(api.markChatRead).not.toHaveBeenCalled();
    showLast(true);
    await waitFor(() => expect(api.markChatRead).toHaveBeenCalledWith("s1", "a1"));
  });
});
