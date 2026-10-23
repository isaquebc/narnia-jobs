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
});
