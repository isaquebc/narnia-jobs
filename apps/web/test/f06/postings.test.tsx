import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { draftPatch } from "../../src/features/postings/PostingForm";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";
import { analysis, note, posting } from "./fixtures";

/** F06/M6 · páginas Vagas: lista, entrada, página editável, duplicata, notas pendentes, análise e bandeja. */
function api(overrides: Record<string, unknown> = {}) {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    listIngestions: async () => ({ runs: [] }),
    listChatSessions: async () => ({ sessions: [] }),
    listPendingNotes: vi.fn(async () => ({ notes: [] })),
    listPostings: vi.fn(async () => ({
      postings: [
        posting("v1"),
        posting("v2", {
          company: "Nubank",
          client: null,
          title: "Engineering Manager",
          role: "engineering_manager",
          seniority: "manager",
        }),
      ],
    })),
    getPosting: vi.fn(async (id: string) => ({
      posting: posting(id),
      contacts: [],
      notes: [],
      duplicates: [],
    })),
    listPostingAnalyses: vi.fn(async () => ({ analyses: [] })),
    ...overrides,
  };
}

describe("F06/M6 · Vagas", () => {
  it("menu tem Vagas em Geral; a lista mostra contratante, cliente, cargo, senioridade, role e data", async () => {
    renderApp({ api: api() as never, initialUrl: "/vagas" });
    const general = await screen.findByRole("group", { name: "Geral" });
    expect(within(general).getByRole("link", { name: "Vagas" })).toHaveAttribute("href", "/vagas");
    const list = await screen.findByRole("list", { name: "Vagas" });
    const card = within(list).getByRole("listitem", { name: "Globex Consultoria / Initech Bank" });
    expect(card).toHaveTextContent("Desenvolvedor(a) Backend Sênior · Sênior");
    expect(card).toHaveTextContent("Backend");
    expect(card).toHaveTextContent(/Salva em/);
    expect(within(list).getByRole("listitem", { name: "Nubank" })).toHaveTextContent(
      "Engineering Manager",
    );
  });

  it("nova vaga pelo texto chama a entrada e abre a página da vaga", async () => {
    const intakePosting = vi.fn(async () => ({ posting: posting("v9"), job: null }));
    const { router } = renderApp({ api: api({ intakePosting }) as never, initialUrl: "/vagas" });
    await userEvent.type(await screen.findByLabelText("Texto da vaga"), "Vaga backend com Java");
    await userEvent.click(screen.getByRole("button", { name: "Salvar vaga" }));
    expect(intakePosting).toHaveBeenCalledWith({ text: "Vaga backend com Java" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/vagas/v9"));
  });

  it("página da vaga: origem por campo, pré-análise, em breve; salvar manda só o que mudou", async () => {
    const patchPosting = vi.fn(async (id: string) => ({ posting: posting(id) }));
    renderApp({ api: api({ patchPosting }) as never, initialUrl: "/vagas/v1" });
    const form = await screen.findByRole("form", { name: "Dados da vaga" });
    expect(within(form).getAllByText("heurística + modelo").length).toBeGreaterThan(0);
    expect(screen.getByText("Cobertura dos obrigatórios: 100%")).toBeInTheDocument();
    expect(screen.getByText("Vaga híbrida; perfil só remoto.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Criar CV para esta vaga" })[0]).toBeDisabled();
    expect(screen.getByText(/Alerta de candidatura repetida/)).toBeInTheDocument();
    const client = within(form).getByLabelText("Empresa cliente (onde vai trabalhar)");
    await userEvent.clear(client);
    await userEvent.type(client, "Initech Brasil");
    await userEvent.click(within(form).getByRole("button", { name: "Salvar" }));
    expect(patchPosting).toHaveBeenCalledWith("v1", { client: "Initech Brasil" });
  });

  it("draftPatch: listas por linha, números, moeda maiúscula e vazio = null", () => {
    const base = { benefits: "", salaryMin: "", currency: "", city: "Recife" } as never;
    expect(
      draftPatch(base, {
        benefits: "- VR\n\n• Plano",
        salaryMin: "15.000",
        currency: "brl",
        city: "",
      } as never),
    ).toEqual({ benefits: ["VR", "Plano"], salaryMin: 15000, currency: "BRL", city: null });
  });

  it("duplicata: modal com certeza e diff; atualizar a salva leva para ela", async () => {
    const decideDuplicate = vi.fn(async () => ({ keptId: "v0", removedId: "v1" }));
    const dup = posting("v1", {
      duplicate: {
        candidateId: "v0",
        sameJob: true,
        confidence: 88,
        differences: [{ field: "cidade", saved: "São Paulo", incoming: "Recife" }],
        rationale: "Mesma descrição.",
        checkedAt: "2026-10-14T12:00:00.000Z",
        decision: null,
      },
    });
    const { router } = renderApp({
      api: api({
        decideDuplicate,
        getPosting: async () => ({ posting: dup, contacts: [], notes: [], duplicates: ["v0"] }),
      }) as never,
      initialUrl: "/vagas/v1",
    });
    const dialog = await screen.findByRole("dialog", { name: "Vaga repetida?" });
    expect(dialog).toHaveTextContent("88% de certeza de que é a mesma vaga");
    expect(within(dialog).getByRole("cell", { name: "Recife" })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Atualizar a vaga salva" }));
    expect(decideDuplicate).toHaveBeenCalledWith("v1", "update");
    await waitFor(() => expect(router.state.location.pathname).toBe("/vagas/v0"));
  });

  it("nota alterada pelo recrutador: antes e depois, confirmar aplica", async () => {
    const decidePostingNote = vi.fn(async () => ({ note: note("n1") }));
    renderApp({
      api: api({
        decidePostingNote,
        getPosting: async () => ({
          posting: posting("v1"),
          contacts: [],
          notes: [note("n1", { pendingBody: "Falei com a Joana; pediu portfólio" })],
          duplicates: [],
        }),
      }) as never,
      initialUrl: "/vagas/v1?nota=n1",
    });
    const pending = await screen.findByRole("region", {
      name: "O recrutador quer alterar esta nota",
    });
    expect(pending).toHaveTextContent("pediu portfólio");
    await userEvent.click(within(pending).getByRole("button", { name: "Confirmar alteração" }));
    expect(decidePostingNote).toHaveBeenCalledWith("v1", "n1", "confirm");
  });

  it("análise: fit por perfil, recomendado, lacunas por severidade; desatualizada oferece reanalisar e abre a conversa", async () => {
    const analyzePosting = vi.fn(async () => ({ session: { id: "s9" } }));
    const { router } = renderApp({
      api: api({
        analyzePosting,
        listPostingAnalyses: async () => ({
          analyses: [analysis({ stale: { facts: true, posting: false } })],
        }),
      }) as never,
      initialUrl: "/vagas/v1",
    });
    const fit = await screen.findByRole("list", { name: "Fit por perfil" });
    expect(fit).toHaveTextContent("Eng");
    expect(fit).toHaveTextContent("78%");
    expect(within(fit).getByText("Recomendado")).toBeInTheDocument();
    const gaps = screen.getByRole("list", { name: "Lacunas (sem evidência nos seus dados)" });
    expect(within(gaps).getAllByRole("listitem")[0]).toHaveTextContent("AWS");
    expect(screen.getByRole("list", { name: "O que você atende" })).toHaveTextContent("Java");
    expect(screen.getByText(/Seus dados ou a vaga mudaram/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Reanalisar" })[0] as HTMLElement);
    expect(analyzePosting).toHaveBeenCalledWith("v1");
    await waitFor(() => expect(router.state.location.pathname).toBe("/chat/s9"));
  });

  it("bandeja: 'Aguardando você' com a nota pendente e o link para a vaga", async () => {
    renderApp({
      api: api({
        listPendingNotes: async () => ({
          notes: [
            {
              note: note("n1", { pendingBody: "x" }),
              posting: { id: "v1", company: "Globex", title: "Dev", role: null },
            },
          ],
        }),
      }) as never,
      initialUrl: "/vagas",
    });
    await act(async () => {
      await userEvent.click(await screen.findByRole("button", { name: "Atividades" }));
    });
    const waiting = await screen.findByRole("list", { name: "Aguardando você" });
    expect(waiting).toHaveTextContent("Alteração de nota em Globex · Dev");
    expect(within(waiting).getByRole("link", { name: "revisar" })).toHaveAttribute(
      "href",
      "/vagas/v1?nota=n1",
    );
  });
});
