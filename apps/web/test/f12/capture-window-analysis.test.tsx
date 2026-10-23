import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type DocumentView } from "../../src/lib/api";
import { profile } from "../components/profile-fixture";
import { shellApi } from "../f03/shell-api";
import { analysis, posting } from "../f06/fixtures";
import { renderApp } from "../router-helpers";

/**
 * F12/M2 · janela da extensão depois de "Salvar vaga" (pedido do dono, 2026-10-23): na mesma janela, as etapas (lendo
 * os detalhes, analisando), o resultado resumido da análise e a geração do CV e/ou da carta, com o andamento e o
 * download.
 */
const capture = (analysisState: Record<string, unknown> = {}) => ({
  id: "c1",
  url: "https://vagas.example/123",
  title: "Vagas",
  createdAt: "2026-10-23T12:00:00.000Z",
  postingId: "v1",
  duplicate: null,
  analysis: { requested: true, sessionId: null, error: null, ...analysisState },
  reading: {
    ok: true,
    title: "Engenheira Backend Sênior",
    company: "Acme Pagamentos",
    siteName: null,
    location: null,
    description: "Descrição.",
    chars: 900,
    message: null,
  },
});

const session = (busy: boolean) =>
  ({ session: { id: "s1", busy, category: "job", postingId: "v1" } }) as never;

const doc = (kind: "cv" | "cover_letter", status: string, pdf = false) =>
  ({
    document: { id: `d-${kind}`, kind, profileId: "p1", postingId: "v1", format: "pdf" },
    current: {
      version: 1,
      status,
      pdfPath: pdf ? `documents/d-${kind}/v1/x.pdf` : null,
      pagesRendered: pdf ? 1 : null,
      textBody: null,
    },
    versions: [],
    stale: null,
    missingLinks: [],
  }) as unknown as DocumentView;

describe("F12/M2 · janela: análise depois de salvar", () => {
  it("mostra lendo os detalhes → analisando → o resultado, na mesma janela", async () => {
    let state = {
      capture: capture(),
      posting: posting("v1", { status: "extracting" }),
      analyses: [] as ReturnType<typeof analysis>[],
      busy: true,
    };
    const { ws } = renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async () => ({ capture: state.capture }) as never,
        getPosting: async () => ({
          posting: state.posting,
          contacts: [],
          notes: [],
          duplicates: [],
        }),
        listPostingAnalyses: async () => ({ analyses: state.analyses }),
        getChatSession: async () => session(state.busy),
        listDocuments: async () => ({ documents: [] }),
      },
      initialUrl: "/candidatura?captura=c1",
    });
    expect(await screen.findByText(/Lendo os detalhes da vaga/)).toBeInTheDocument();

    state = {
      ...state,
      capture: capture({ sessionId: "s1" }),
      posting: posting("v1", { status: "ready" }),
    };
    act(() => ws.emit({ type: "posting.updated", postingId: "v1" }));
    expect(await screen.findByText(/Analisando a vaga/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Acompanhar na conversa" })).toHaveAttribute(
      "href",
      "/chat/s1",
    );

    state = { ...state, analyses: [analysis({ postingId: "v1" })], busy: false };
    act(() => ws.emit({ type: "posting.updated", postingId: "v1" }));
    const result = await screen.findByRole("region", { name: "Análise da vaga" });
    expect(within(result).getByText("Boa aderência ao perfil de backend.")).toBeInTheDocument();
    expect(await within(result).findByText(/Eng · fit 78/)).toBeInTheDocument();
    expect(within(result).getByText("AWS")).toBeInTheDocument();
    expect(within(result).getByRole("link", { name: "Ver a análise completa" })).toHaveAttribute(
      "href",
      "/vagas/v1",
    );
    expect(screen.getByRole("button", { name: "Gerar CV e carta" })).toBeInTheDocument();
  });

  it("análise que terminou sem resultado: avisa e Analisar de novo", async () => {
    const analyzeCapture = vi.fn(async () => session(true));
    renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async () => ({ capture: capture({ sessionId: "s1" }) }) as never,
        getPosting: async () => ({
          posting: posting("v1"),
          contacts: [],
          notes: [],
          duplicates: [],
        }),
        listPostingAnalyses: async () => ({ analyses: [] }),
        getChatSession: async () => session(false),
        listDocuments: async () => ({ documents: [] }),
        analyzeCapture,
      },
      initialUrl: "/candidatura?captura=c1",
    });
    expect(await screen.findByText(/A análise terminou sem resultado/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Analisar de novo" }));
    expect(analyzeCapture).toHaveBeenCalledWith("c1");
  });

  it("teto de conversas cheio: explica e deixa analisar de novo", async () => {
    renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async () =>
          ({ capture: capture({ error: "session_limit" }) }) as never,
        getPosting: async () => ({
          posting: posting("v1"),
          contacts: [],
          notes: [],
          duplicates: [],
        }),
        listPostingAnalyses: async () => ({ analyses: [] }),
        listDocuments: async () => ({ documents: [] }),
      },
      initialUrl: "/candidatura?captura=c1",
    });
    expect(await screen.findByText(/muitas conversas abertas/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analisar de novo" })).toBeInTheDocument();
  });
});

describe("F12/M2 · janela: CV e carta", () => {
  const base = {
    ...shellApi,
    getExtensionCapture: async () => ({ capture: capture({ sessionId: "s1" }) }) as never,
    getPosting: async () => ({ posting: posting("v1"), contacts: [], notes: [], duplicates: [] }),
    listPostingAnalyses: async () => ({ analyses: [analysis({ postingId: "v1" })] }),
    getChatSession: async () => session(false),
    documentPdfUrl: (id: string, v: number) => `/api/documents/${id}/versions/${v}/pdf`,
  };

  it("gera os dois com o perfil recomendado, mostra o andamento e o download", async () => {
    let documents: DocumentView[] = [];
    const generateDocument = vi.fn(async () => {
      documents = [doc("cv", "generating"), doc("cover_letter", "queued")];
      return { documents };
    });
    const { ws } = renderApp({
      api: { ...base, listDocuments: async () => ({ documents }), generateDocument },
      initialUrl: "/candidatura?captura=c1",
    });
    await userEvent.click(await screen.findByRole("button", { name: "Gerar CV e carta" }));
    expect(generateDocument).toHaveBeenCalledWith({
      kind: "cv",
      profileId: "p1",
      postingId: "v1",
      withCoverLetter: true,
    });
    const docs = screen.getByRole("region", { name: "Currículo e carta" });
    expect(await within(docs).findAllByText(/Gerando/)).toHaveLength(2);
    documents = [doc("cv", "ready", true), doc("cover_letter", "generating")];
    act(() =>
      ws.emit({
        type: "document.updated",
        documentId: "d-cv",
        profileId: "p1",
        postingId: "v1",
        status: "ready",
      }),
    );
    const download = await within(docs).findByRole("link", { name: "Baixar o CV" });
    expect(download).toHaveAttribute("href", "/api/documents/d-cv/versions/1/pdf");
    expect(within(docs).queryByRole("link", { name: "Baixar a carta" })).toBeNull();
  });

  it("só a carta; com mais de um perfil, escolhe qual", async () => {
    const generateDocument = vi.fn(async () => ({ documents: [] }));
    renderApp({
      api: {
        ...base,
        listProfiles: async () => ({
          profiles: [
            profile("p1", { isActive: true, name: "Eng" }),
            profile("p2", { name: "Liderança" }),
          ],
        }),
        listDocuments: async () => ({ documents: [] }),
        generateDocument,
      },
      initialUrl: "/candidatura?captura=c1",
    });
    await userEvent.selectOptions(await screen.findByLabelText("Perfil"), "p2");
    await userEvent.click(screen.getByRole("button", { name: "Gerar carta" }));
    expect(generateDocument).toHaveBeenCalledWith({
      kind: "cover_letter",
      profileId: "p2",
      postingId: "v1",
    });
  });

  it("idioma da vaga não coberto: pergunta e gera mesmo assim", async () => {
    const generateDocument = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(409, "language_not_covered", "Idioma não coberto", { language: "en" }),
      )
      .mockResolvedValueOnce({ documents: [] });
    renderApp({
      api: { ...base, listDocuments: async () => ({ documents: [] }), generateDocument },
      initialUrl: "/candidatura?captura=c1",
    });
    await userEvent.click(await screen.findByRole("button", { name: "Gerar CV" }));
    await userEvent.click(await screen.findByRole("button", { name: "Gerar mesmo assim" }));
    await waitFor(() =>
      expect(generateDocument).toHaveBeenLastCalledWith({
        kind: "cv",
        profileId: "p1",
        postingId: "v1",
        acceptLanguage: true,
      }),
    );
  });

  it("vaga repetida: a janela mostra a comparação e a análise espera a decisão", async () => {
    let current = capture();
    let saved = posting("v1", {
      status: "ready",
      duplicate: {
        candidateId: "v0",
        sameJob: true,
        confidence: 92,
        differences: [],
        rationale: "Mesmo link.",
        checkedAt: "2026-10-23T12:00:00.000Z",
        decision: null,
      },
    });
    const decideDuplicate = vi.fn(async () => {
      current = { ...capture({ sessionId: "s1" }), postingId: "v0" };
      saved = posting("v0", { status: "ready" });
      return { keptId: "v0", removedId: "v1" };
    });
    renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async () => ({ capture: current }) as never,
        getPosting: async () => ({ posting: saved, contacts: [], notes: [], duplicates: ["v0"] }),
        listPostingAnalyses: async () => ({ analyses: [] }),
        getChatSession: async () => session(true),
        listDocuments: async () => ({ documents: [] }),
        decideDuplicate,
      },
      initialUrl: "/candidatura?captura=c1",
    });
    const dialog = await screen.findByRole("dialog", { name: "Vaga repetida?" });
    expect(screen.getByText(/A análise começa depois que você decidir/)).toBeInTheDocument();
    expect(screen.queryByText(/Lendo os detalhes da vaga/)).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Atualizar a vaga salva" }));
    expect(decideDuplicate).toHaveBeenCalledWith("v1", "update");
    // a janela passa a acompanhar a vaga salva
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Abrir a vaga no narnia" })).toHaveAttribute(
        "href",
        "/vagas/v0",
      ),
    );
    expect(await screen.findByText(/Analisando a vaga/)).toBeInTheDocument();
  });
});
