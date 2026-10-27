import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shellApi } from "../f03/shell-api";
import { analysis, posting } from "../f06/fixtures";
import { renderApp } from "../router-helpers";

/**
 * Pedidos do dono (2026-10-27) na janela da extensão: (1) depois da análise, "Procurar o formulário nesta aba" lê a
 * mesma aba do Chrome e o formulário entra nesta aba da janela, sem duplicar a vaga; (2) as abas viram um menu com o
 * andamento de cada uma: processando, terminou sem você ver (bolinha verde) e vista (check verde); o botão do menu
 * mostra a bolinha se alguma tem novidade, senão o carregando se alguma processa, senão nada.
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
  createdAt: "2026-10-27T12:00:00.000Z",
  postingId: null,
  duplicate: null,
  applicationId: null,
  applicationUrl: null,
  mode: "posting",
  analysis: { requested: false, sessionId: null, error: null },
  reading: reading(id === "c1" ? "Backend Sr" : "Frontend Pleno"),
  ...over,
});

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

describe("procurar o formulário na aba da vaga", () => {
  afterEach(() => {
    delete document.documentElement.dataset.narniaExtension;
  });

  const saved = () =>
    capture("c1", { postingId: "v1", analysis: { requested: true, sessionId: "s1", error: null } });
  const postingApi = {
    getPosting: async () => ({
      posting: posting("v1", { status: "ready" }),
      contacts: [],
      notes: [],
      duplicates: [],
    }),
    listPostingAnalyses: async () => ({ analyses: [analysis({ postingId: "v1" })] }),
    getChatSession: async () => ({ session: { id: "s1", busy: false } }) as never,
    listDocuments: async () => ({ documents: [] }),
  };

  it("depois da análise, lê a mesma aba e a janela passa a mostrar o formulário nesta aba", async () => {
    const bridge = fakeBridge(() => ({ ok: true, applicationId: "a1" }));
    let current: Record<string, unknown> = saved();
    const getExtensionCapture = vi.fn(async () => ({ capture: current }) as never);
    renderApp({
      api: {
        ...shellApi,
        ...postingApi,
        getExtensionCapture,
        getApplication: async () =>
          ({
            application: {
              id: "a1",
              captureId: "c1",
              url: "https://vagas.example/c1/aplicar",
              title: null,
              status: "locating",
              error: null,
              warning: null,
              postingId: "v1",
              posting: { title: "Backend Sr", company: "Acme" },
              profileId: "p1",
              answersStatus: "idle",
              answersError: null,
              createdAt: "2026-10-27T12:00:00.000Z",
              updatedAt: "2026-10-27T12:00:00.000Z",
              questions: [],
            },
          }) as never,
      } as never,
      initialUrl: "/candidatura?captura=c1&aba=7",
    });
    const find = await screen.findByRole("button", { name: "Procurar o formulário nesta aba" });
    current = capture("c1", {
      postingId: "v1",
      applicationId: "a1",
      applicationUrl: "https://vagas.example/c1/aplicar",
    });
    await userEvent.click(find);
    await waitFor(() =>
      expect(bridge.seen).toEqual([{ type: "narnia.readForm", tabId: 7, captureId: "c1" }]),
    );
    // a mesma aba da janela, agora no modo formulário
    expect(await screen.findByText(/Organizando as perguntas/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Procurar o formulário nesta aba" })).toBeNull();
    bridge.stop();
  });

  it("sem acesso à página ou sem formulário: mostra o que fazer", async () => {
    const bridge = fakeBridge(() => ({
      ok: false,
      code: "no_form",
      error: "Não achei um formulário nesta aba.",
    }));
    renderApp({
      api: {
        ...shellApi,
        ...postingApi,
        getExtensionCapture: async () => ({ capture: saved() }) as never,
      } as never,
      initialUrl: "/candidatura?captura=c1&aba=7",
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Procurar o formulário nesta aba" }),
    );
    expect(await screen.findByText("Não achei um formulário nesta aba.")).toBeInTheDocument();
    bridge.stop();
  });

  it("sem a extensão (ou sem a aba de origem), o botão não aparece", async () => {
    renderApp({
      api: {
        ...shellApi,
        ...postingApi,
        getExtensionCapture: async () => ({ capture: saved() }) as never,
      } as never,
      initialUrl: "/candidatura?captura=c1&aba=7",
    });
    await screen.findByRole("region", { name: "Análise da vaga" });
    expect(screen.queryByRole("button", { name: "Procurar o formulário nesta aba" })).toBeNull();
  });
});

describe("menu das abas com o andamento", () => {
  beforeEach(() => sessionStorage.clear());

  const indicator = (el: HTMLElement) =>
    ["Processando", "Atualização não vista", "Vista"].filter((name) =>
      within(el).queryByRole("img", { name }),
    );

  it("cada aba com o seu estado; o botão do menu resume (novidade > processando > nada)", async () => {
    const busy: Record<string, boolean> = { c1: false, c2: true };
    const { router, ws } = renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async (id: string) => ({ capture: capture(id) }) as never,
        getCaptureActivity: async (ids: string[]) => ({
          items: ids.map((id) => ({ id, busy: busy[id] ?? false })),
        }),
      } as never,
      initialUrl: "/candidatura?captura=c2&aba=8",
    });
    await screen.findByRole("heading", { name: "Frontend Pleno" });
    await act(() =>
      router.navigate({ to: "/candidatura", search: { captura: "c1", aba: 7, erro: undefined } }),
    );
    await screen.findByRole("heading", { name: "Backend Sr" });
    const trigger = screen.getByRole("button", { name: /^Páginas abertas/ });
    expect(trigger).toHaveTextContent("Backend Sr");
    await waitFor(() => expect(indicator(trigger)).toEqual(["Processando"]));
    await userEvent.click(trigger);
    const menu = screen.getByRole("list", { name: "Páginas abertas" });
    const item = (name: string) =>
      within(menu)
        .getAllByRole("listitem")
        .find((li) => li.textContent?.includes(name)) as HTMLElement;
    expect(indicator(item("Backend Sr"))).toEqual(["Vista"]);
    expect(indicator(item("Frontend Pleno"))).toEqual(["Processando"]);

    // a outra aba terminou sem você ver: bolinha nela e no botão do menu
    busy.c2 = false;
    act(() => ws.emit({ type: "posting.updated", postingId: "v9" }));
    await waitFor(() =>
      expect(indicator(item("Frontend Pleno"))).toEqual(["Atualização não vista"]),
    );
    expect(indicator(trigger)).toEqual(["Atualização não vista"]);

    // abrir a aba conta como ver: check nela e nada no botão do menu
    await userEvent.click(
      within(item("Frontend Pleno")).getByRole("button", { name: "Frontend Pleno" }),
    );
    await screen.findByRole("heading", { name: "Frontend Pleno" });
    const after = screen.getByRole("button", { name: /^Páginas abertas/ });
    await waitFor(() => expect(indicator(after)).toEqual([]));
    await userEvent.click(after);
    const menu2 = screen.getByRole("list", { name: "Páginas abertas" });
    const second = within(menu2)
      .getAllByRole("listitem")
      .find((li) => li.textContent?.includes("Frontend Pleno")) as HTMLElement;
    expect(indicator(second)).toEqual(["Vista"]);
  });
});
