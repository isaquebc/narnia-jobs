import type { PostingContact } from "@narnia-jobs/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type DocumentView } from "../../src/lib/api";
import { profile } from "../components/profile-fixture";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";
import { posting } from "./fixtures";

const cv: DocumentView = {
  document: {
    id: "d1",
    kind: "cv",
    profileId: "p1",
    postingId: "v1",
    templateId: "classico",
    paper: "A4",
    locale: "pt-BR",
    format: "pdf",
    currentVersion: 2,
    createdAt: "2026-10-16T12:00:00Z",
    updatedAt: "2026-10-16T12:00:00Z",
  },
  current: {
    id: "ver2",
    documentId: "d1",
    version: 2,
    source: "agent",
    instructions: null,
    templateId: "classico",
    locale: "pt-BR",
    paper: "A4",
    format: "pdf",
    content: null,
    status: "ready",
    attempts: 1,
    review: { passed: true, atsScore: 95, issues: [] },
    atsScore: 95,
    pagesRendered: 2,
    pdfPath: "documents/d1/v2/cv.pdf",
    textBody: null,
    factsVersion: 1,
    postingUpdatedAt: null,
    profileHash: "h",
    jobId: null,
    usage: [],
    error: null,
    createdAt: "2026-10-16T12:00:00Z",
    updatedAt: "2026-10-16T12:00:00Z",
  } as DocumentView["current"],
  versions: [],
  stale: { facts: false, profile: false, posting: false },
  missingLinks: [],
};

const contact = (id: string, over: Partial<PostingContact> = {}): PostingContact => ({
  id,
  postingId: "v1",
  name: `Pessoa ${id}`,
  origin: "linkedin",
  email: null,
  phone: null,
  linkedinUrl: null,
  pinned: false,
  createdAt: "2026-10-10T12:00:00.000Z",
  ...over,
});

function api(overrides: Record<string, unknown> = {}, contacts: PostingContact[] = []) {
  return {
    ...shellApi,
    listProfiles: async () => ({ profiles: [profile("p1", { isActive: true, name: "Eng" })] }),
    getProfile: async (id: string) => profile(id, { name: "Eng" }),
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    listIngestions: async () => ({ runs: [] }),
    listChatSessions: async () => ({ sessions: [] }),
    listPendingNotes: async () => ({ notes: [] }),
    listPostingAnalyses: async () => ({ analyses: [] }),
    listDocuments: vi.fn(async () => ({ documents: [cv] })),
    documentPdfUrl: (id: string, v: number) => `/api/documents/${id}/versions/${v}/pdf`,
    documentPageUrl: (id: string, v: number, p: number) =>
      `/api/documents/${id}/versions/${v}/pages/${p}`,
    getPosting: vi.fn(async (id: string) => ({
      posting: posting(id),
      contacts,
      notes: [],
      duplicates: [],
    })),
    addPostingContact: vi.fn(async () => ({ contact: contact("novo") })),
    pinPostingContact: vi.fn(async () => ({ contact: contact("c3", { pinned: true }) })),
    documentFeedback: vi.fn(async () => ({ session: { id: "s9" } })),
    ...overrides,
  };
}

/**
 * Página da vaga (pedido do dono, 2026-10-19): na coluna da pré-análise, antes dela, os assets (CV e carta pequenos,
 * baixar e regerar com mensagem) e os contatos (fixado + os dois últimos, modal para adicionar com LinkedIn).
 */
describe("Página da vaga · assets e contatos", () => {
  it("assets e contatos ficam na coluna da direita, antes da pré-análise", async () => {
    renderApp({ api: api() as never, initialUrl: "/vagas/v1" });
    const assets = await screen.findByRole("region", { name: "Currículo e carta" });
    const contacts = screen.getByRole("region", { name: "Últimos contatos" });
    const pre = screen.getByText("Pré-análise (sem tokens)");
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(assets, contacts)).toBe(true);
    expect(follows(contacts, pre)).toBe(true);
  });

  it("CV pequeno com a página 1, baixar o PDF; sem carta, o atalho de gerar abre o Gerar da carta", async () => {
    renderApp({ api: api() as never, initialUrl: "/vagas/v1" });
    const assets = await screen.findByRole("region", { name: "Currículo e carta" });
    const card = await within(assets).findByRole("group", { name: "Currículo" });
    expect(within(card).getByRole("img")).toHaveAttribute(
      "src",
      "/api/documents/d1/versions/2/pages/1",
    );
    expect(within(card).getByRole("link", { name: "Baixar PDF" })).toHaveAttribute(
      "href",
      "/api/documents/d1/versions/2/pdf",
    );
    const letter = within(assets).getByRole("group", { name: "Carta de apresentação" });
    await userEvent.click(within(letter).getByRole("button", { name: "Gerar carta" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(/carta/i);
  });

  it("regerar com mensagem: o pedido abre a conversa da vaga com o CV no contexto", async () => {
    const a = api();
    const { router } = renderApp({ api: a as never, initialUrl: "/vagas/v1" });
    const assets = await screen.findByRole("region", { name: "Currículo e carta" });
    const card = await within(assets).findByRole("group", { name: "Currículo" });
    await userEvent.click(within(card).getByRole("button", { name: "Regerar com mensagem" }));
    const dialog = await screen.findByRole("dialog", { name: "Regerar com mensagem" });
    const send = within(dialog).getByRole("button", { name: "Abrir conversa" });
    expect(send).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("O que mudar"), "Mais liderança");
    await userEvent.click(send);
    expect(a.documentFeedback).toHaveBeenCalledWith("d1", "Mais liderança");
    await waitFor(() => expect(router.state.location.pathname).toBe("/chat/s9"));
  });

  it("contatos: o fixado mais os dois últimos, sem repetir o fixado; fixar outro chama a API", async () => {
    const contacts = [
      contact("c1", { createdAt: "2026-10-01T12:00:00.000Z" }),
      contact("c2", { createdAt: "2026-10-02T12:00:00.000Z" }),
      contact("c3", { createdAt: "2026-10-03T12:00:00.000Z" }),
      contact("c4", {
        createdAt: "2026-09-01T12:00:00.000Z",
        pinned: true,
        linkedinUrl: "https://linkedin.com/in/c4",
      }),
    ];
    const a = api({}, contacts);
    renderApp({ api: a as never, initialUrl: "/vagas/v1" });
    const region = await screen.findByRole("region", { name: "Últimos contatos" });
    const items = await within(region).findAllByRole("listitem");
    expect(items.map((i) => within(i).getByText(/^Pessoa/).textContent)).toEqual([
      "Pessoa c4",
      "Pessoa c3",
      "Pessoa c2",
    ]);
    expect(within(items[0] as HTMLElement).getByRole("link", { name: /LinkedIn/ })).toHaveAttribute(
      "href",
      "https://linkedin.com/in/c4",
    );
    await userEvent.click(within(region).getByRole("button", { name: "Fixar Pessoa c3" }));
    expect(a.pinPostingContact).toHaveBeenCalledWith("v1", "c3", true);
  });

  it("sem contatos: card de adicionar; a modal manda o LinkedIn e mostra a duplicata recusada", async () => {
    const addPostingContact = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(409, "duplicate_contact", "Esse contato já está na vaga (Joana)."),
      )
      .mockResolvedValueOnce({ contact: contact("novo") });
    renderApp({ api: api({ addPostingContact }) as never, initialUrl: "/vagas/v1" });
    const region = await screen.findByRole("region", { name: "Últimos contatos" });
    await userEvent.click(within(region).getByRole("button", { name: "Adicionar contato" }));
    const dialog = await screen.findByRole("dialog", { name: "Adicionar contato" });
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Joana");
    await userEvent.type(
      within(dialog).getByLabelText("LinkedIn (link do perfil)"),
      "linkedin.com/in/joana",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar contato" }));
    expect(addPostingContact).toHaveBeenCalledWith("v1", {
      name: "Joana",
      origin: "linkedin",
      email: null,
      phone: null,
      linkedinUrl: "linkedin.com/in/joana",
    });
    expect(await within(dialog).findByText(/já está na vaga/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar contato" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("com contatos, o botão do topo da seção também abre a modal", async () => {
    renderApp({ api: api({}, [contact("c1")]) as never, initialUrl: "/vagas/v1" });
    const region = await screen.findByRole("region", { name: "Últimos contatos" });
    await userEvent.click(within(region).getByRole("button", { name: "Adicionar contato" }));
    expect(await screen.findByRole("dialog", { name: "Adicionar contato" })).toBeInTheDocument();
  });
});
