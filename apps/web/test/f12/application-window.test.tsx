import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { shellApi } from "../f03/shell-api";
import { message, session } from "../f04/fixtures";
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
  mode: "form",
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

  it("sem vaga ligada (ou a errada): escolher a vaga salva na janela", async () => {
    const linkApplicationPosting = vi.fn(
      async (_id: string, _p: string | null) => ({ application: application() }) as never,
    );
    renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async () => ({ capture }) as never,
        getApplication: async () =>
          ({ application: application({ postingId: null, posting: null }) }) as never,
        listPostings: async () =>
          ({
            postings: [
              { id: "v1", title: "Backend Sr", company: "Acme" },
              { id: "v2", title: "Senior Software Engineer - Vitalis Labs", company: "Vitalis" },
            ],
          }) as never,
        linkApplicationPosting,
      },
      initialUrl: "/candidatura?captura=c1",
    });
    await userEvent.click(await screen.findByRole("button", { name: "Ligar a uma vaga salva" }));
    await userEvent.selectOptions(
      await screen.findByRole("combobox", { name: "Vaga salva" }),
      "Senior Software Engineer - Vitalis Labs · Vitalis",
    );
    expect(linkApplicationPosting).toHaveBeenCalledWith("a1", "v2");
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

describe("F12/M5 · conversa do formulário na janela", () => {
  const chat = {
    getChatSession: vi.fn(async (id: string) => ({
      session: session(id, { title: "Acme - Backend · Formulário", category: "job" }),
    })),
    listChatMessages: vi.fn(async () => ({
      messages: [message("m1", { role: "user", contentMd: "Deixa a motivação mais curta." })],
    })),
    sendChatMessage: vi.fn(async () => ({ turnIndex: 1 })),
    listResearch: vi.fn(async () => ({ sources: [] })),
    getProfileCard: vi.fn(async () => ({
      profileId: "p1",
      text: "",
      tokensEst: 0,
      hash: "h",
      factsVersion: 1,
      builtAt: "2026-10-11T12:00:00.000Z",
      valid: true,
    })),
  };

  it("Perguntas | Conversa: a primeira mensagem cria a conversa do formulário e o chat do recrutador aparece", async () => {
    let current = application({ chatSessionId: null });
    const openApplicationChat = vi.fn(async (_id: string, _m: string) => {
      current = application({ chatSessionId: "s-form" });
      return { session: session("s-form", { category: "job" }) };
    });
    renderApp({
      api: {
        ...shellApi,
        ...chat,
        getExtensionCapture: async () => ({ capture }) as never,
        getApplication: async () => ({ application: current }) as never,
        openApplicationChat,
      },
      initialUrl: "/candidatura?captura=c1",
    });
    await screen.findByRole("list", { name: "Perguntas do formulário" });
    await userEvent.click(screen.getByRole("button", { name: "Conversa" }));
    expect(screen.queryByRole("list", { name: "Perguntas do formulário" })).toBeNull();
    const box = screen.getByRole("textbox", { name: "Mensagem para o recrutador" });
    await userEvent.type(box, "Deixa a motivação mais curta.");
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(openApplicationChat).toHaveBeenCalledWith("a1", "Deixa a motivação mais curta.");
    // o chat do recrutador, com a mensagem, no lugar do campo inicial
    expect(await screen.findByText("Deixa a motivação mais curta.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Perguntas" }));
    expect(
      await screen.findByRole("list", { name: "Perguntas do formulário" }),
    ).toBeInTheDocument();
  });

  it("'Ajustar no chat' numa resposta abre a conversa com a pergunta no campo", async () => {
    renderApp({
      api: {
        ...shellApi,
        ...chat,
        getExtensionCapture: async () => ({ capture }) as never,
        getApplication: async () =>
          ({ application: application({ chatSessionId: null }) }) as never,
        openApplicationChat: vi.fn(),
      },
      initialUrl: "/candidatura?captura=c1",
    });
    const list = await screen.findByRole("list", { name: "Perguntas do formulário" });
    const motivo = within(list).getAllByRole("listitem")[2] as HTMLElement;
    await userEvent.click(within(motivo).getByRole("button", { name: "Ajustar no chat" }));
    expect(screen.getByRole("textbox", { name: "Mensagem para o recrutador" })).toHaveValue(
      'Sobre a pergunta "Por que você quer trabalhar aqui?": ',
    );
  });
});

describe("F12/M5 · sem vaga (F12-11) e autodeclaração (F12-12)", () => {
  const raca = (prefill: string | null) =>
    q("q5", {
      question: "Raça/cor",
      kind: "self_declaration",
      topic: "race",
      options: [
        { value: "b", label: "Branco(a)" },
        { value: "p", label: "Pardo(a)" },
      ],
      prefill,
      section: "Perguntas",
    });

  it("sem vaga ligada: colar a descrição na conversa", async () => {
    renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async () => ({ capture }) as never,
        getApplication: async () =>
          ({
            application: application({ postingId: null, posting: null, chatSessionId: null }),
          }) as never,
        listPostings: async () => ({ postings: [] }),
      },
      initialUrl: "/candidatura?captura=c1",
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Colar a descrição na conversa" }),
    );
    expect(screen.getByRole("textbox", { name: "Mensagem para o recrutador" })).toHaveValue(
      "Esta é a descrição da vaga deste formulário:\n",
    );
  });

  it("autodeclaração não dada: responder no chat; já dada: a opção da página com Preencher, fora do Preencher todos", async () => {
    let current = application({ chatSessionId: null });
    current.questions[4] = raca(null) as never;
    const { unmount } = renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async () => ({ capture }) as never,
        getApplication: async () => ({ application: current }) as never,
      },
      initialUrl: "/candidatura?captura=c1",
    });
    let list = await screen.findByRole("list", { name: "Perguntas do formulário" });
    let item = within(list).getAllByRole("listitem")[4] as HTMLElement;
    await userEvent.click(within(item).getByRole("button", { name: "Responder no chat" }));
    expect(screen.getByRole("textbox", { name: "Mensagem para o recrutador" })).toHaveValue(
      'Sobre a autodeclaração "Raça/cor": ',
    );
    unmount();

    current = application({ chatSessionId: null });
    current.questions[4] = raca("Pardo(a)") as never;
    const bridge: unknown[] = [];
    document.documentElement.dataset.narniaExtension = "1";
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { source?: string; id?: string; request?: unknown };
      if (d?.source !== "narnia-web") return;
      bridge.push(d.request);
      window.postMessage(
        { source: "narnia-ext", id: d.id, response: { ok: true, filled: ["f1"], failed: [] } },
        "*",
      );
    };
    window.addEventListener("message", onMessage);
    renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async () => ({ capture }) as never,
        getApplication: async () => ({ application: current }) as never,
      },
      initialUrl: "/candidatura?captura=c1&aba=7",
    });
    list = await screen.findByRole("list", { name: "Perguntas do formulário" });
    item = within(list).getAllByRole("listitem")[4] as HTMLElement;
    expect(item).toHaveTextContent("Pardo(a)");
    expect(item).toHaveTextContent("Você declarou no chat");
    await userEvent.click(within(item).getByRole("button", { name: "Preencher" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(bridge).toContainEqual(
      expect.objectContaining({ items: [{ ref: "f1", value: "Pardo(a)" }] }),
    );
    bridge.length = 0;
    await userEvent.click(screen.getByRole("button", { name: "Preencher todos" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const all = bridge[0] as { items: Array<{ value: string }> };
    expect(all.items.map((x) => x.value)).not.toContain("Pardo(a)");
    window.removeEventListener("message", onMessage);
    delete document.documentElement.dataset.narniaExtension;
  });
});
