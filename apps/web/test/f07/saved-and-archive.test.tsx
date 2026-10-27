import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { shellApi } from "../f03/shell-api";
import { posting } from "../f06/fixtures";
import { renderApp } from "../router-helpers";

/**
 * F07 (pedido do dono 2026-10-27): a lista de vagas destaca as aplicadas; o quadro começa pela coluna "Vagas salvas"
 * (vagas sem candidatura, com o Aplicar); a página da vaga arquiva com o motivo ("não deu um bom fit") e desarquiva.
 */
function api(overrides: Record<string, unknown> = {}) {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    listIngestions: async () => ({ runs: [] }),
    listChatSessions: async () => ({ sessions: [] }),
    listPendingNotes: async () => ({ notes: [] }),
    getPosting: async (id: string) => ({
      posting: posting(id),
      contacts: [],
      notes: [],
      duplicates: [],
    }),
    listPostingAnalyses: async () => ({ analyses: [] }),
    listDocuments: async () => ({ documents: [] }),
    getApplyOptions: async () => ({ cvs: [], coverLetters: [], activeApplicationId: null }),
    listJobApplications: async () => ({ applications: [], saved: [] }),
    ...overrides,
  };
}

describe("F07 · lista de vagas", () => {
  it("destaca a vaga aplicada com a coluna da candidatura; arquivadas à parte", async () => {
    const listPostings = vi.fn(async (_q?: string, archived?: boolean) => ({
      postings: archived
        ? [
            {
              ...posting("v3", { company: "Gama" }),
              archiveReason: "salary",
              archivedAt: "2026-10-27T12:00:00.000Z",
              application: null,
            },
          ]
        : [
            {
              ...posting("v1", { company: "Acme" }),
              application: { id: "a1", column: "in_process", archived: false },
            },
            { ...posting("v2", { company: "Beta" }), application: null },
          ],
    }));
    renderApp({ api: api({ listPostings }) as never, initialUrl: "/vagas" });
    const acme = await screen.findByRole("listitem", { name: /Acme/ });
    expect(within(acme).getByText("Aplicada · Em processo")).toBeInTheDocument();
    expect(acme.querySelector("[data-applied]")).not.toBeNull();
    const beta = screen.getByRole("listitem", { name: /Beta/ });
    expect(within(beta).queryByText(/Aplicada/)).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: "Ver arquivadas" }));
    await waitFor(() => expect(listPostings).toHaveBeenLastCalledWith(undefined, true));
    const gama = await screen.findByRole("listitem", { name: /Gama/ });
    expect(within(gama).getByText("Arquivada · Salário")).toBeInTheDocument();
  });
});

describe("F07 · coluna Vagas salvas", () => {
  it("vem antes de Aplicado, com a vaga e o Aplicar", async () => {
    renderApp({
      api: api({
        listJobApplications: async () => ({
          applications: [],
          saved: [
            {
              id: "v9",
              company: "Acme",
              client: null,
              title: "Backend Sr",
              role: "backend",
              createdAt: "2026-10-25T12:00:00.000Z",
              archivedAt: null,
              archiveReason: null,
            },
          ],
        }),
      }) as never,
      initialUrl: "/candidaturas",
    });
    const board = await screen.findByRole("region", { name: "Quadro das candidaturas" });
    const headings = within(board)
      .getAllByRole("heading")
      .map((h) => h.textContent?.replace(/\d+$/, ""));
    expect(headings[0]).toBe("Vagas salvas");
    expect(headings[1]).toBe("Aplicado");
    const saved = within(board).getByRole("list", { name: "Vagas salvas" });
    expect(await within(saved).findByRole("link", { name: "Acme" })).toHaveAttribute(
      "href",
      "/vagas/v9",
    );
    expect(await within(saved).findByRole("button", { name: "Aplicar" })).toBeInTheDocument();
  });
});

describe("F07 · arquivar a vaga", () => {
  it("pede o motivo (e aceita uma nota); a vaga arquivada mostra o motivo e desarquiva", async () => {
    const archivePosting = vi.fn(async (id: string) => ({ posting: posting(id) }));
    const a = api({ archivePosting });
    renderApp({ api: a as never, initialUrl: "/vagas/v1" });
    await userEvent.click(await screen.findByRole("button", { name: "Arquivar vaga" }));
    const dialog = await screen.findByRole("dialog", { name: "Arquivar vaga" });
    const confirm = within(dialog).getByRole("button", { name: "Arquivar" });
    expect(confirm).toBeDisabled();
    await userEvent.selectOptions(
      within(dialog).getByRole("combobox", { name: /Por que não deu fit/ }),
      "seniority",
    );
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Detalhe/ }), "Pede staff");
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(archivePosting).toHaveBeenCalledWith("v1", {
        reason: "seniority",
        note: "Pede staff",
      }),
    );
  });

  it("vaga arquivada: o motivo no topo, Desarquivar e sem o Aplicar", async () => {
    const unarchivePosting = vi.fn(async (id: string) => ({ posting: posting(id) }));
    renderApp({
      api: api({
        getPosting: async (id: string) => ({
          posting: {
            ...posting(id),
            archivedAt: "2026-10-27T12:00:00.000Z",
            archiveReason: "stack",
            archiveNote: "Só PHP",
          },
          contacts: [],
          notes: [],
          duplicates: [],
        }),
        unarchivePosting,
      }) as never,
      initialUrl: "/vagas/v1",
    });
    expect(await screen.findByText(/Arquivada em .* · Stack/)).toBeInTheDocument();
    expect(screen.getByText("Só PHP")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aplicar" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Desarquivar" }));
    await waitFor(() => expect(unarchivePosting).toHaveBeenCalledWith("v1"));
  });

  it("com candidatura ativa não há Arquivar vaga", async () => {
    renderApp({
      api: api({
        getApplyOptions: async () => ({ cvs: [], coverLetters: [], activeApplicationId: "a1" }),
      }) as never,
      initialUrl: "/vagas/v1",
    });
    await screen.findByRole("link", { name: "Ver candidatura" });
    expect(screen.queryByRole("button", { name: "Arquivar vaga" })).toBeNull();
  });
});
