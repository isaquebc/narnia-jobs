import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";

/**
 * Pedidos do dono (2026-10-23) na janela da extensão: abas (F12-16) para acompanhar mais de uma página ao mesmo tempo;
 * "Ir para a página" (F12-17) volta à aba analisada pela extensão ou abre o link numa janela nova; preencher (F12-14)
 * campo a campo ou todos, pela extensão, sem enviar.
 */
const reading = (title: string) => ({
  ok: true,
  title,
  company: "Acme",
  siteName: null,
  location: null,
  description: "Descrição.",
  chars: 900,
  message: null,
});
const capture = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  url: `https://vagas.example/${id}`,
  title: "Vagas",
  createdAt: "2026-10-23T12:00:00.000Z",
  postingId: null,
  duplicate: null,
  applicationId: null,
  mode: "posting",
  analysis: { requested: false, sessionId: null, error: null },
  reading: reading(id === "c1" ? "Backend Sr" : "Frontend Pleno"),
  ...over,
});

/** A ponte da extensão na página: responde aos pedidos da janela e guarda o que chegou. */
function fakeBridge(response: (req: { type: string }) => unknown) {
  const seen: Array<Record<string, unknown>> = [];
  document.documentElement.dataset.narniaExtension = "1";
  const onMessage = (e: MessageEvent) => {
    const d = e.data as { source?: string; id?: string; request?: Record<string, unknown> };
    if (d?.source !== "narnia-web") return;
    seen.push(d.request as Record<string, unknown>);
    window.postMessage(
      { source: "narnia-ext", id: d.id, response: response(d.request as { type: string }) },
      "*",
    );
  };
  window.addEventListener("message", onMessage);
  return { seen, stop: () => window.removeEventListener("message", onMessage) };
}

describe("janela da extensão: abas, voltar à página e preencher", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    delete document.documentElement.dataset.narniaExtension;
  });

  it("cada página aberta pela extensão vira uma aba; dá para voltar e fechar", async () => {
    const { router } = renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async (id: string) => ({ capture: capture(id) }) as never,
      },
      initialUrl: "/candidatura?captura=c1&aba=7",
    });
    expect(await screen.findByRole("heading", { name: "Backend Sr" })).toBeInTheDocument();
    await act(() =>
      router.navigate({ to: "/candidatura", search: { captura: "c2", aba: 8, erro: undefined } }),
    );
    expect(await screen.findByRole("heading", { name: "Frontend Pleno" })).toBeInTheDocument();
    const tabs = screen.getByRole("tablist", { name: "Páginas abertas" });
    expect(
      within(tabs)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual(["Backend Sr", "Frontend Pleno"]);
    await userEvent.click(within(tabs).getByRole("tab", { name: "Backend Sr" }));
    expect(await screen.findByRole("heading", { name: "Backend Sr" })).toBeInTheDocument();
    await userEvent.click(within(tabs).getByRole("button", { name: "Fechar Frontend Pleno" }));
    await waitFor(() => expect(within(tabs).getAllByRole("tab")).toHaveLength(1));
  });

  it("bandeja: o botão no topo abre a bandeja em overlay e os links abrem na janela normal", async () => {
    renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async (id: string) => ({ capture: capture(id) }) as never,
      },
      initialUrl: "/candidatura?captura=c1&aba=7",
    });
    await screen.findByRole("heading", { name: "Backend Sr" });
    await userEvent.click(screen.getByRole("button", { name: "Atividades" }));
    const tray = await screen.findByRole("dialog", { name: "Atividades" });
    expect(within(tray).getByRole("link", { name: "Ver todos os processos" })).toHaveAttribute(
      "target",
      "_blank",
    );
    await userEvent.click(within(tray).getByRole("button", { name: "Fechar a bandeja" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Atividades" })).toBeNull());
  });

  it("ir para a página: pede à extensão para focar a aba; sem a extensão, abre o link", async () => {
    const bridge = fakeBridge(() => ({ ok: true, focused: true }));
    renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async (id: string) => ({ capture: capture(id) }) as never,
      },
      initialUrl: "/candidatura?captura=c1&aba=7",
    });
    await userEvent.click(await screen.findByRole("button", { name: "Ir para a página" }));
    await waitFor(() =>
      expect(bridge.seen).toEqual([
        { type: "narnia.focus", tabId: 7, url: "https://vagas.example/c1" },
      ]),
    );
    bridge.stop();
    delete document.documentElement.dataset.narniaExtension;
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await userEvent.click(screen.getByRole("button", { name: "Ir para a página" }));
    expect(open).toHaveBeenCalledWith("https://vagas.example/c1", "_blank", "noopener");
    open.mockRestore();
  });

  it("preencher um campo ou todos (sem consentimento) pela extensão", async () => {
    const bridge = fakeBridge(() => ({ ok: true, filled: ["f1", "f2"], failed: [] }));
    const q = (id: string, ref: string, over: Record<string, unknown>) => ({
      id,
      question: id,
      kind: "short_text",
      options: [],
      required: false,
      maxChars: null,
      fieldRefs: [ref],
      section: null,
      profileField: null,
      topic: null,
      source: "heuristic",
      prefill: null,
      ...over,
    });
    renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async (id: string) =>
          ({ capture: capture(id, { applicationId: "a1", mode: "form" }) }) as never,
        getApplication: async () =>
          ({
            application: {
              id: "a1",
              captureId: "c1",
              url: "https://vagas.example/c1",
              title: null,
              status: "ready",
              error: null,
              warning: null,
              postingId: null,
              posting: null,
              profileId: null,
              createdAt: "2026-10-23T12:00:00.000Z",
              updatedAt: "2026-10-23T12:00:00.000Z",
              questions: [
                q("Nome", "f1", { profileField: "full_name", prefill: "Ana Maria Exemplo" }),
                q("E-mail", "f2", { profileField: "email", prefill: "ana@example.com" }),
                q("Termos", "f3", { kind: "consent" }),
              ],
            },
          }) as never,
      },
      initialUrl: "/candidatura?captura=c1&aba=7",
    });
    const list = await screen.findByRole("list", { name: "Perguntas do formulário" });
    const first = within(list).getAllByRole("listitem")[0] as HTMLElement;
    await userEvent.click(within(first).getByRole("button", { name: "Preencher" }));
    await waitFor(() =>
      expect(bridge.seen[0]).toEqual({
        type: "narnia.fill",
        tabId: 7,
        url: "https://vagas.example/c1",
        items: [{ ref: "f1", value: "Ana Maria Exemplo" }],
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Preencher todos" }));
    await waitFor(() =>
      expect(bridge.seen[1]?.items).toEqual([
        { ref: "f1", value: "Ana Maria Exemplo" },
        { ref: "f2", value: "ana@example.com" },
      ]),
    );
    expect(
      await screen.findByText("2 campos preenchidos na página. Confira antes de enviar."),
    ).toBeInTheDocument();
    bridge.stop();
  });

  it("F12/M4: respostas sugeridas com copiar e preencher; lacuna; CV anexado no campo do currículo", async () => {
    const bridge = fakeBridge(() => ({ ok: true, filled: ["f2"], failed: [] }));
    const q = (id: string, ref: string, over: Record<string, unknown>) => ({
      id,
      question: id,
      kind: "short_text",
      options: [],
      required: false,
      maxChars: null,
      fieldRefs: [ref],
      section: null,
      profileField: null,
      topic: null,
      source: "model",
      prefill: null,
      answer: null,
      ...over,
    });
    const ans = (text: string | null, gap: string | null = null) => ({
      questionId: "x",
      version: 1,
      answer: text,
      origins: [],
      gap,
      assumptions: [],
      source: "model",
      createdAt: "2026-10-23T12:00:00.000Z",
    });
    const generateApplicationAnswers = vi.fn(async () => ({ job: null }));
    const fetchMock = vi.fn(
      async () => new Response("%PDF-1.4", { headers: { "content-type": "application/pdf" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async (id: string) =>
          ({ capture: capture(id, { applicationId: "a1", mode: "form" }) }) as never,
        getApplication: async () =>
          ({
            application: {
              id: "a1",
              captureId: "c1",
              url: "https://vagas.example/c1",
              title: null,
              status: "ready",
              error: null,
              warning: null,
              postingId: "v1",
              posting: { title: "Backend Sr", company: "Acme" },
              profileId: "p1",
              answersStatus: "ready",
              answersError: null,
              createdAt: "2026-10-23T12:00:00.000Z",
              updatedAt: "2026-10-23T12:00:00.000Z",
              questions: [
                q("Currículo", "f1", { kind: "file" }),
                q("Por que a Acme?", "f2", {
                  kind: "long_text",
                  answer: ans("Porque pagamentos."),
                }),
                q("Anos de Rust", "f3", {
                  kind: "number",
                  answer: ans(null, "Os dados não dizem."),
                }),
              ],
            },
          }) as never,
        getPosting: async () =>
          ({ posting: { id: "v1" }, contacts: [], notes: [], duplicates: [] }) as never,
        listPostingAnalyses: async () => ({ analyses: [] }),
        listDocuments: async () =>
          ({
            documents: [
              {
                document: {
                  id: "d-cv",
                  kind: "cv",
                  profileId: "p1",
                  postingId: "v1",
                  format: "pdf",
                },
                current: {
                  version: 2,
                  status: "ready",
                  pdfPath: "x.pdf",
                  pagesRendered: 1,
                  textBody: null,
                },
                versions: [],
                stale: null,
                missingLinks: [],
              },
            ],
          }) as never,
        documentPdfUrl: (id: string, v: number) => `/api/documents/${id}/versions/${v}/pdf`,
        generateApplicationAnswers,
      },
      initialUrl: "/candidatura?captura=c1&aba=7",
    });
    const list = await screen.findByRole("list", { name: "Perguntas do formulário" });
    const items = within(list).getAllByRole("listitem");
    expect(
      within(items[1] as HTMLElement).getByRole("textbox", { name: "Resposta: Por que a Acme?" }),
    ).toHaveValue("Porque pagamentos.");
    expect(items[2]).toHaveTextContent("Falta: Os dados não dizem.");
    await userEvent.click(
      within(items[1] as HTMLElement).getByRole("button", { name: "Preencher" }),
    );
    await waitFor(() =>
      expect(bridge.seen.at(-1)?.items).toEqual([{ ref: "f2", value: "Porque pagamentos." }]),
    );
    // o campo do currículo anexa o PDF do CV da vaga
    await userEvent.click(
      await within(items[0] as HTMLElement).findByRole("button", { name: "Anexar o CV" }),
    );
    await waitFor(() =>
      expect(bridge.seen.at(-1)?.items).toEqual([
        {
          ref: "f1",
          value: "",
          file: { name: "curriculo.pdf", type: "application/pdf", base64: btoa("%PDF-1.4") },
        },
      ]),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/documents/d-cv/versions/2/pdf", expect.anything());
    await userEvent.click(screen.getByRole("button", { name: "Gerar respostas de novo" }));
    expect(generateApplicationAnswers).toHaveBeenCalledWith("a1");
    vi.unstubAllGlobals();
    bridge.stop();
  });
  it("F12-18/F12-19: o rascunho escrito como você mostra o que supôs; você edita, guarda e preenche o texto editado", async () => {
    const bridge = fakeBridge(() => ({ ok: true, filled: ["f1"], failed: [] }));
    const editApplicationAnswer = vi.fn(async (_id: string, _q: string, answer: string) => {
      const f = form(answer);
      return { application: { ...f, questions: [motivo(answer, "edited", []), f.questions[1]] } };
    });
    const motivo = (text: string, source: string, assumptions: string[]) => ({
      id: "q1",
      question: "Briefly describe why you are interested in Vitalis.",
      kind: "short_text",
      options: [],
      required: true,
      maxChars: null,
      fieldRefs: ["f1"],
      section: null,
      profileField: null,
      topic: null,
      source: "model",
      prefill: null,
      answer: {
        questionId: "q1",
        version: source === "edited" ? 2 : 1,
        answer: text,
        origins: [],
        gap: null,
        assumptions,
        source,
        createdAt: "2026-10-24T12:00:00.000Z",
      },
    });
    const form = (text: string) => ({
      id: "a1",
      captureId: "c1",
      url: "https://vagas.example/c1",
      title: null,
      status: "ready",
      error: null,
      warning: null,
      postingId: "v1",
      posting: { title: "Senior Software Engineer", company: "Vitalis" },
      profileId: "p1",
      answersStatus: "ready",
      answersError: null,
      createdAt: "2026-10-24T12:00:00.000Z",
      updatedAt: "2026-10-24T12:00:00.000Z",
      questions: [
        motivo(text, "roleplay", ["Que você quer trabalhar com saúde."]),
        {
          ...motivo("", "model", []),
          id: "q2",
          question: "Anos de Rust",
          kind: "number",
          fieldRefs: ["f2"],
          answer: {
            ...motivo("", "model", []).answer,
            questionId: "q2",
            answer: null,
            gap: "Os dados não dizem.",
          },
        },
      ],
    });
    renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async (id: string) =>
          ({ capture: capture(id, { applicationId: "a1", mode: "form" }) }) as never,
        getApplication: async () =>
          ({ application: form("I want to help people with HSA.") }) as never,
        getPosting: async () =>
          ({ posting: { id: "v1" }, contacts: [], notes: [], duplicates: [] }) as never,
        listPostingAnalyses: async () => ({ analyses: [] }),
        listDocuments: async () => ({ documents: [] }) as never,
        editApplicationAnswer,
      } as never,
      initialUrl: "/candidatura?captura=c1&aba=7",
    });
    const list = await screen.findByRole("list", { name: "Perguntas do formulário" });
    const first = within(list).getAllByRole("listitem")[0] as HTMLElement;
    expect(first).toHaveTextContent("Escrita como você");
    expect(first).toHaveTextContent("Confira antes de preencher");
    expect(first).toHaveTextContent("Que você quer trabalhar com saúde.");
    const box = within(first).getByRole("textbox", {
      name: "Resposta: Briefly describe why you are interested in Vitalis.",
    });
    await userEvent.clear(box);
    await userEvent.type(box, "Vitalis makes health spending simpler.");
    // preencher usa o texto editado, mesmo antes de guardar
    await userEvent.click(within(first).getByRole("button", { name: "Preencher" }));
    await waitFor(() =>
      expect(bridge.seen.at(-1)?.items).toEqual([
        { ref: "f1", value: "Vitalis makes health spending simpler." },
      ]),
    );
    // sair do campo guarda a edição como versão sua
    await userEvent.tab();
    await waitFor(() =>
      expect(editApplicationAnswer).toHaveBeenCalledWith(
        "a1",
        "q1",
        "Vitalis makes health spending simpler.",
      ),
    );
    expect(await within(first).findByText("Editada por você")).toBeInTheDocument();
    // lacuna: dá para escrever a própria resposta
    const second = within(list).getAllByRole("listitem")[1] as HTMLElement;
    expect(second).toHaveTextContent("Falta: Os dados não dizem.");
    await userEvent.type(
      within(second).getByRole("textbox", { name: "Resposta: Anos de Rust" }),
      "2",
    );
    await userEvent.click(screen.getByRole("button", { name: "Preencher todos" }));
    await waitFor(() =>
      expect(bridge.seen.at(-1)?.items).toEqual([
        { ref: "f1", value: "Vitalis makes health spending simpler." },
        { ref: "f2", value: "2" },
      ]),
    );
    bridge.stop();
  });
});
