import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";

/**
 * F12/M3 · janela no modo formulário: a captura de uma página com formulário mostra as perguntas na ordem da página,
 * com o valor dos campos óbvios para copiar; consentimento e autodeclaração ficam com a pessoa (F12-12).
 */
const capture = {
  id: "c1",
  url: "https://acme.example/aplicar",
  title: "Candidatura",
  createdAt: "2026-10-23T12:00:00.000Z",
  postingId: null,
  duplicate: null,
  applicationId: "a1",
  analysis: { requested: false, sessionId: null, error: null },
  reading: {
    ok: false,
    title: null,
    company: null,
    siteName: null,
    location: null,
    description: null,
    chars: 0,
    message: "Não parece uma vaga.",
  },
};

const q = (id: string, over: Record<string, unknown>) => ({
  id,
  question: "Pergunta",
  kind: "short_text",
  options: [],
  required: false,
  maxChars: null,
  fieldRefs: ["f1"],
  section: null,
  profileField: null,
  topic: null,
  source: "heuristic",
  prefill: null,
  ...over,
});

const application = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  captureId: "c1",
  url: "https://acme.example/aplicar",
  title: "Candidatura",
  status: "ready",
  error: null,
  warning: null,
  postingId: "v1",
  posting: { title: "Backend Sr", company: "Acme" },
  profileId: "p1",
  createdAt: "2026-10-23T12:00:00.000Z",
  updatedAt: "2026-10-23T12:00:00.000Z",
  questions: [
    q("q1", {
      question: "Nome completo",
      required: true,
      profileField: "full_name",
      prefill: "Ana Maria Exemplo",
      section: "Dados pessoais",
    }),
    q("q2", {
      question: "Telefone",
      profileField: "phone",
      prefill: null,
      section: "Dados pessoais",
    }),
    q("q3", {
      question: "Por que você quer trabalhar aqui?",
      kind: "long_text",
      maxChars: 800,
      source: "model",
      section: "Perguntas",
    }),
    q("q4", {
      question: "Disponível para viagens?",
      kind: "choice",
      options: [
        { value: "s", label: "Sim" },
        { value: "n", label: "Não" },
      ],
      section: "Perguntas",
    }),
    q("q5", {
      question: "Raça/cor",
      kind: "self_declaration",
      topic: "race",
      section: "Perguntas",
    }),
    q("q6", {
      question: "Aceito a política de privacidade",
      kind: "consent",
      section: "Perguntas",
    }),
  ],
  ...over,
});

describe("F12/M3 · janela: formulário de candidatura", () => {
  it("perguntas na ordem, por seção, com o valor dos campos óbvios para copiar", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async () => ({ capture }) as never,
        getApplication: async () => ({ application: application() }) as never,
      },
      initialUrl: "/candidatura?captura=c1",
    });
    const list = await screen.findByRole("list", { name: "Perguntas do formulário" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(6);
    expect(screen.getByText("Dados pessoais")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Backend Sr · Acme" })).toHaveAttribute(
      "href",
      "/vagas/v1",
    );
    const name = items[0] as HTMLElement;
    expect(name).toHaveTextContent("Nome completo");
    expect(name).toHaveTextContent("obrigatória");
    expect(name).toHaveTextContent("Ana Maria Exemplo");
    await userEvent.click(within(name).getByRole("button", { name: "Copiar" }));
    expect(writeText).toHaveBeenCalledWith("Ana Maria Exemplo");
    expect(items[1]).toHaveTextContent("Esse dado não está no narnia");
    expect(items[2]).toHaveTextContent("até 800 caracteres");
    expect(items[3]).toHaveTextContent("Sim · Não");
    expect(items[4]).toHaveTextContent(/autodeclaração/i);
    expect(within(items[4] as HTMLElement).queryByRole("button", { name: "Copiar" })).toBeNull();
    expect(items[5]).toHaveTextContent(/Você decide/);
  });

  it("vaga ligada: o CV e a carta da vaga na janela (gerar quando não há; baixar quando há)", async () => {
    const doc = {
      document: { id: "d-cv", kind: "cv", profileId: "p1", postingId: "v1", format: "pdf" },
      current: {
        version: 1,
        status: "ready",
        pdfPath: "documents/d-cv/v1/x.pdf",
        pagesRendered: 1,
        textBody: null,
      },
      versions: [],
      stale: null,
      missingLinks: [],
    };
    renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async () => ({ capture }) as never,
        getApplication: async () => ({ application: application() }) as never,
        getPosting: async () =>
          ({ posting: { id: "v1" }, contacts: [], notes: [], duplicates: [] }) as never,
        listPostingAnalyses: async () => ({ analyses: [] }),
        listDocuments: async () => ({ documents: [doc] }) as never,
        documentPdfUrl: (id: string, v: number) => `/api/documents/${id}/versions/${v}/pdf`,
      },
      initialUrl: "/candidatura?captura=c1",
    });
    const docs = await screen.findByRole("region", { name: "Currículo e carta" });
    expect(await within(docs).findByRole("link", { name: "Baixar o CV" })).toBeInTheDocument();
    expect(within(docs).getByRole("button", { name: "Gerar carta" })).toBeInTheDocument();
  });

  it("organizando: mostra o andamento e recarrega quando o worker avisa", async () => {
    let current = application({ status: "locating", questions: [] });
    const { ws } = renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async () => ({ capture }) as never,
        getApplication: async () => ({ application: current }) as never,
      },
      initialUrl: "/candidatura?captura=c1",
    });
    expect(await screen.findByText(/Organizando as perguntas/)).toBeInTheDocument();
    current = application();
    act(() => ws.emit({ type: "application.updated", applicationId: "a1" }));
    expect(
      await screen.findByRole("list", { name: "Perguntas do formulário" }),
    ).toBeInTheDocument();
  });

  it("modelo falhou: perguntas pelos rótulos, com o aviso e o detalhe", async () => {
    renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async () => ({ capture }) as never,
        getApplication: async () =>
          ({ application: application({ warning: "Claude Code: timeout" }) }) as never,
      },
      initialUrl: "/candidatura?captura=c1",
    });
    expect(await screen.findByText(/montei as perguntas pelos rótulos/)).toBeInTheDocument();
    expect(screen.getByText(/Claude Code: timeout/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Perguntas do formulário" })).toBeInTheDocument();
  });

  it("erro: ler de novo pede as perguntas outra vez; sem vaga ligada, avisa", async () => {
    const relocateApplication = vi.fn(async () => ({ job: null }));
    renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async () => ({ capture }) as never,
        getApplication: async () =>
          ({
            application: application({
              status: "error",
              error: "x",
              questions: [],
              postingId: null,
              posting: null,
            }),
          }) as never,
        relocateApplication,
      },
      initialUrl: "/candidatura?captura=c1",
    });
    expect(await screen.findByText(/Não deu para organizar as perguntas/)).toBeInTheDocument();
    expect(screen.getByText(/Detalhe: x/)).toBeInTheDocument();
    expect(screen.getByText(/Nenhuma vaga ligada/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ler de novo" }));
    expect(relocateApplication).toHaveBeenCalledWith("a1");
  });
});
