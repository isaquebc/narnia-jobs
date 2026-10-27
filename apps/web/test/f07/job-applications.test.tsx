import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { shellApi } from "../f03/shell-api";
import { posting } from "../f06/fixtures";
import { renderApp } from "../router-helpers";

/**
 * F07/M1 · candidaturas na web (§0): o "Aplicar" da vaga trava o CV (obrigatório) e a carta e deixa trocar a data antes
 * de confirmar; a página de candidaturas mostra o quadro de 5 colunas, o "x/N" só em "Em processo", busca, arquivadas e
 * encerrar pede o motivo.
 */
const stages = [
  "Análise de currículo",
  "Bate-papo com Talent",
  "Entrevista com liderança",
  "Entrevista técnica",
  "Oferta",
  "Contratação",
].map((name, i) => ({ id: `st${i + 1}`, name, position: i + 1 }));

const app = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  postingId: "v1",
  profileId: "p1",
  cv: { documentId: "d1", versionId: "dv2", version: 2, scope: "posting" },
  coverLetter: null,
  appliedOn: "2026-10-20",
  column: "applied",
  closedReason: null,
  stages,
  currentStageId: "st1",
  lastActivityAt: "2026-10-20T12:00:00.000Z",
  archivedAt: null,
  createdAt: "2026-10-20T12:00:00.000Z",
  updatedAt: "2026-10-20T12:00:00.000Z",
  posting: { company: "Acme", client: null, title: "Backend Sr", role: "backend" },
  contacts: [],
  progress: { current: 1, total: 6 },
  ...over,
});

const option = (versionId: string, version: number, scope: "posting" | "profile") => ({
  documentId: scope === "posting" ? "d1" : "d0",
  versionId,
  version,
  scope,
  profileId: "p1",
  createdAt: "2026-10-20T12:00:00.000Z",
});

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
    getApplyOptions: vi.fn(async () => ({
      cvs: [option("dv2", 2, "posting"), option("dv0", 1, "profile")],
      coverLetters: [option("lv1", 1, "posting")],
      activeApplicationId: null,
    })),
    createJobApplication: vi.fn(async () => ({ application: app("a1") })),
    listJobApplications: vi.fn(async () => ({ applications: [] })),
    patchJobApplication: vi.fn(async (id: string) => ({ application: app(id) })),
    ...overrides,
  };
}

describe("F07/M1 · Aplicar na página da vaga", () => {
  it("trava o CV escolhido e a carta; a data é hoje e muda só pelo botão, antes de confirmar", async () => {
    const a = api();
    renderApp({ api: a as never, initialUrl: "/vagas/v1" });
    await userEvent.click(await screen.findByRole("button", { name: "Aplicar" }));
    const dialog = await screen.findByRole("dialog", { name: "Aplicar nesta vaga" });
    const cvs = within(dialog).getByRole("radiogroup", { name: "Currículo enviado" });
    expect(within(cvs).getByRole("radio", { name: "CV desta vaga · versão 2" })).toBeChecked();
    await userEvent.click(
      within(cvs).getByRole("radio", { name: "CV geral do perfil · versão 1" }),
    );
    await userEvent.selectOptions(
      within(dialog).getByRole("combobox", { name: "Carta enviada" }),
      "lv1",
    );
    expect(within(dialog).queryByLabelText("Data da candidatura")).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Mudar a data" }));
    const date = within(dialog).getByLabelText("Data da candidatura");
    await userEvent.clear(date);
    await userEvent.type(date, "2026-10-25");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirmar candidatura" }));
    await waitFor(() =>
      expect(a.createJobApplication).toHaveBeenCalledWith({
        postingId: "v1",
        cvVersionId: "dv0",
        coverLetterVersionId: "lv1",
        appliedOn: "2026-10-25",
      }),
    );
  });

  it("sem currículo pronto não há candidatura: o diálogo leva a gerar o CV", async () => {
    const a = api({
      getApplyOptions: vi.fn(async () => ({
        cvs: [],
        coverLetters: [],
        activeApplicationId: null,
      })),
    });
    renderApp({ api: a as never, initialUrl: "/vagas/v1" });
    await userEvent.click(await screen.findByRole("button", { name: "Aplicar" }));
    const dialog = await screen.findByRole("dialog", { name: "Aplicar nesta vaga" });
    expect(
      within(dialog).getByText(/Toda candidatura precisa de um currículo/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Confirmar candidatura" })).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Gerar o currículo" }));
    expect(await screen.findByRole("dialog", { name: /currículo/i })).toBeInTheDocument();
  });

  it("vaga com candidatura ativa: no lugar do Aplicar, o link para ela", async () => {
    renderApp({
      api: api({
        getApplyOptions: async () => ({ cvs: [], coverLetters: [], activeApplicationId: "a9" }),
      }) as never,
      initialUrl: "/vagas/v1",
    });
    expect(await screen.findByRole("link", { name: "Ver candidatura" })).toHaveAttribute(
      "href",
      "/candidaturas/a9",
    );
    expect(screen.queryByRole("button", { name: "Aplicar" })).toBeNull();
  });
});

describe("F07/M1 · página de candidaturas", () => {
  it("cinco colunas; o x/N só no cartão em Em processo", async () => {
    renderApp({
      api: api({
        listJobApplications: vi.fn(async () => ({
          applications: [
            app("a1"),
            app("a2", {
              column: "in_process",
              currentStageId: "st3",
              progress: { current: 3, total: 6 },
              posting: { company: "Beta", client: null, title: "Frontend", role: "frontend" },
            }),
          ],
        })),
      }) as never,
      initialUrl: "/candidaturas",
    });
    const board = await screen.findByRole("region", { name: "Quadro das candidaturas" });
    const cols = ["Aplicado", "1ª Entrevista", "Em processo", "Oferta", "Encerrado"];
    for (const c of cols) expect(within(board).getByRole("heading", { name: c })).toBeVisible();
    const applied = within(board).getByRole("list", { name: "Aplicado" });
    expect(await within(applied).findByText("Acme")).toBeInTheDocument();
    expect(within(applied).queryByText(/^\d+\/\d+$/)).toBeNull();
    const inProcess = within(board).getByRole("list", { name: "Em processo" });
    expect(within(inProcess).getByText("3/6")).toBeInTheDocument();
    expect(within(inProcess).getByText(/Entrevista com liderança/)).toBeInTheDocument();
  });

  it("busca e arquivadas pedem ao servidor", async () => {
    const listJobApplications = vi.fn(async () => ({ applications: [] }));
    renderApp({ api: api({ listJobApplications }) as never, initialUrl: "/candidaturas" });
    const search = await screen.findByRole("searchbox", { name: "Buscar candidaturas" });
    await userEvent.type(search, "maria");
    await waitFor(() =>
      expect(listJobApplications).toHaveBeenLastCalledWith({ q: "maria", archived: false }),
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "Ver arquivadas" }));
    await waitFor(() =>
      expect(listJobApplications).toHaveBeenLastCalledWith({ q: "maria", archived: true }),
    );
  });

  it("mover de coluna pelo cartão; Encerrado pede o motivo", async () => {
    const patchJobApplication = vi.fn(async (id: string) => ({ application: app(id) }));
    renderApp({
      api: api({
        listJobApplications: async () => ({ applications: [app("a1")] }),
        patchJobApplication,
      }) as never,
      initialUrl: "/candidaturas",
    });
    const card = await screen.findByRole("listitem", { name: /Acme/ });
    await userEvent.click(within(card).getByRole("button", { name: "Mover" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "1ª Entrevista" }));
    await waitFor(() =>
      expect(patchJobApplication).toHaveBeenCalledWith("a1", { column: "first_interview" }),
    );
    await userEvent.click(within(card).getByRole("button", { name: "Mover" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Encerrado" }));
    const dialog = await screen.findByRole("dialog", { name: "Encerrar candidatura" });
    const confirm = within(dialog).getByRole("button", { name: "Encerrar" });
    expect(confirm).toBeDisabled();
    await userEvent.selectOptions(
      within(dialog).getByRole("combobox", { name: /Motivo/ }),
      "rejected",
    );
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(patchJobApplication).toHaveBeenLastCalledWith("a1", {
        column: "closed",
        closedReason: "rejected",
      }),
    );
  });
});

describe("F07/M1 · uma candidatura", () => {
  it("mostra o CV e a carta travados, as etapas com a atual e arquiva", async () => {
    const patchJobApplication = vi.fn(async (id: string) => ({ application: app(id) }));
    renderApp({
      api: api({
        getJobApplication: async (id: string) => ({
          application: app(id, {
            coverLetter: { documentId: "d2", versionId: "lv1", version: 1, scope: "posting" },
          }),
        }),
        patchJobApplication,
        documentPdfUrl: (id: string, v: number) => `/api/documents/${id}/versions/${v}/pdf`,
      }) as never,
      initialUrl: "/candidaturas/a1",
    });
    expect(await screen.findByRole("heading", { name: "Acme" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Baixar a versão 2" })).toHaveAttribute(
      "href",
      "/api/documents/d1/versions/2/pdf",
    );
    expect(screen.getByText(/Carta desta vaga · versão 1/)).toBeInTheDocument();
    const stagesList = screen.getByRole("list", { name: "Etapas do processo" });
    expect(within(stagesList).getAllByRole("listitem")).toHaveLength(6);
    expect(
      within(stagesList)
        .getByText(/Análise de currículo/)
        .closest("li"),
    ).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("link", { name: "Abrir a vaga" })).toHaveAttribute("href", "/vagas/v1");
    await userEvent.click(screen.getByRole("button", { name: "Arquivar" }));
    await waitFor(() => expect(patchJobApplication).toHaveBeenCalledWith("a1", { archived: true }));
  });
});
