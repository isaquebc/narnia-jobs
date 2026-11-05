import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { shellApi } from "../f03/shell-api";
import { posting } from "../f06/fixtures";
import { renderApp } from "../router-helpers";

/**
 * F07/M6 · pessoas e cadeia de contatos na candidatura: os contatos da vaga em ordem (data da conversa), com papel,
 * canal, quem indicou e o resumo; adicionar um contato com esses campos.
 */
const contact = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  postingId: "v1",
  name: `Pessoa ${id}`,
  origin: "linkedin",
  email: null,
  phone: null,
  linkedinUrl: null,
  pinned: false,
  role: null,
  contactedOn: null,
  summary: null,
  referredById: null,
  createdAt: "2026-10-10T12:00:00.000Z",
  ...over,
});

const contacts = [
  contact("c2", {
    name: "João Lima",
    origin: "email",
    role: "hiring_manager",
    contactedOn: "2026-10-21",
    referredById: "c1",
  }),
  contact("c1", {
    name: "Maria Souza",
    role: "referral",
    contactedOn: "2026-10-18",
    summary: "Ex-colega, me indicou ao gestor",
  }),
];

const app = {
  id: "a1",
  postingId: "v1",
  profileId: "p1",
  cv: { documentId: "d1", versionId: "dv2", version: 2, scope: "posting" },
  coverLetter: null,
  appliedOn: "2026-10-20",
  column: "applied",
  closedReason: null,
  stages: [],
  currentStageId: null,
  lastActivityAt: "2026-10-20T12:00:00.000Z",
  archivedAt: null,
  createdAt: "2026-10-20T12:00:00.000Z",
  updatedAt: "2026-10-20T12:00:00.000Z",
  posting: { company: "Acme", client: null, title: "Backend Sr", role: "backend" },
  contacts: ["João Lima", "Maria Souza"],
  progress: { current: 0, total: 0 },
};

function api() {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    listIngestions: async () => ({ runs: [] }),
    listChatSessions: async () => ({ sessions: [] }),
    listPendingNotes: async () => ({ notes: [] }),
    getJobApplication: async () => ({ application: app }),
    documentPdfUrl: () => "/x.pdf",
    listJobApplicationEntries: async () => ({ entries: [] }),
    listJobApplicationEvents: async () => ({ events: [] }),
    getPosting: async () => ({ posting: posting("v1"), contacts, notes: [], duplicates: [] }),
    listPostingAnalyses: async () => ({ analyses: [] }),
    addPostingContact: vi.fn(async () => ({ contact: contact("c3") })),
    patchPostingContact: vi.fn(async () => ({ contact: contact("c2") })),
  };
}

describe("F07/M6 · cadeia de contatos na candidatura", () => {
  it("em ordem de data, com papel, canal, data, quem indicou e o resumo", async () => {
    renderApp({ api: api() as never, initialUrl: "/candidaturas/a1" });
    const chain = await screen.findByRole("list", { name: "Cadeia de contatos" });
    const items = await within(chain).findAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Maria Souza");
    expect(items[0]).toHaveTextContent("Indicação");
    expect(items[0]).toHaveTextContent("18/10/2026");
    expect(items[0]).toHaveTextContent("Ex-colega, me indicou ao gestor");
    expect(items[1]).toHaveTextContent("João Lima");
    expect(items[1]).toHaveTextContent("Gestor(a)");
    expect(items[1]).toHaveTextContent("Indicado(a) por Maria Souza");
  });

  it("adiciona um contato com papel, data, quem indicou e resumo", async () => {
    const a = api();
    renderApp({ api: a as never, initialUrl: "/candidaturas/a1" });
    await screen.findByRole("list", { name: "Cadeia de contatos" });
    await userEvent.click(screen.getByRole("button", { name: "Adicionar contato" }));
    const dialog = await screen.findByRole("dialog", { name: "Adicionar contato" });
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Ana Reis");
    await userEvent.selectOptions(within(dialog).getByLabelText("Papel"), "interviewer");
    await userEvent.type(within(dialog).getByLabelText("Data do contato"), "2026-10-25");
    await userEvent.selectOptions(within(dialog).getByLabelText("Indicado(a) por"), "c2");
    await userEvent.type(within(dialog).getByLabelText("Resumo"), "Fez a entrevista técnica");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar contato" }));
    await waitFor(() =>
      expect(a.addPostingContact).toHaveBeenCalledWith(
        "v1",
        expect.objectContaining({
          name: "Ana Reis",
          role: "interviewer",
          contactedOn: "2026-10-25",
          referredById: "c2",
          summary: "Fez a entrevista técnica",
        }),
      ),
    );
  });

  it("edita um contato da cadeia: quem indicou fica sem a própria pessoa", async () => {
    const a = api();
    renderApp({ api: a as never, initialUrl: "/candidaturas/a1" });
    const chain = await screen.findByRole("list", { name: "Cadeia de contatos" });
    await userEvent.click(await within(chain).findByRole("button", { name: "Editar João Lima" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar contato" });
    const referrer = within(dialog).getByLabelText("Indicado(a) por");
    expect(referrer).toHaveValue("c1");
    expect(within(referrer).queryByRole("option", { name: "João Lima" })).toBeNull();
    await userEvent.type(within(dialog).getByLabelText("Resumo"), "Gestor da área");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() =>
      expect(a.patchPostingContact).toHaveBeenCalledWith(
        "v1",
        "c2",
        expect.objectContaining({
          name: "João Lima",
          referredById: "c1",
          summary: "Gestor da área",
        }),
      ),
    );
  });
});
