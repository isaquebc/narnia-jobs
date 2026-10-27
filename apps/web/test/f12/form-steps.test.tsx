import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";

/**
 * F12/M6 · formulário em várias etapas: as perguntas aparecem por etapa, a da aba marcada como "esta página"; preencher
 * só vale nela (as outras ficam para copiar); a etapa nova organizando não esconde as já prontas; e "Ler a próxima
 * etapa" lê a mesma aba de novo.
 */
const capture = {
  id: "c1",
  url: "https://jobs.acme.example/apply",
  title: "Apply",
  createdAt: "2026-10-27T12:00:00.000Z",
  postingId: "v1",
  duplicate: null,
  applicationId: "a1",
  applicationUrl: "https://jobs.acme.example/apply/2",
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
    message: "",
  },
};

const q = (id: string, step: number, over: Record<string, unknown>) => ({
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
  answer: null,
  assumptionStatus: [],
  step,
  ...over,
});

const application = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  captureId: "c1",
  url: "https://jobs.acme.example/apply/2",
  title: "Apply · 2",
  status: "ready",
  error: null,
  warning: null,
  postingId: "v1",
  posting: { title: "Backend Sr", company: "Acme" },
  profileId: "p1",
  answersStatus: "idle",
  answersError: null,
  answersProfileId: "p1",
  chatSessionId: null,
  createdAt: "2026-10-27T12:00:00.000Z",
  updatedAt: "2026-10-27T12:00:00.000Z",
  currentStep: 2,
  steps: [
    { n: 1, url: "https://jobs.acme.example/apply", title: "Apply", status: "ready" },
    { n: 2, url: "https://jobs.acme.example/apply/2", title: "Apply · 2", status: "ready" },
  ],
  questions: [
    q("q1", 1, {
      question: "Nome completo",
      profileField: "full_name",
      prefill: "Ana Maria Exemplo",
    }),
    q("s2q1", 2, { question: "Cidade", profileField: "city", prefill: "Campinas" }),
  ],
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

const base = {
  ...shellApi,
  getExtensionCapture: async () => ({ capture }) as never,
  listDocuments: async () => ({ documents: [] }) as never,
};

describe("F12/M6 · janela com as etapas do formulário", () => {
  afterEach(() => {
    delete document.documentElement.dataset.narniaExtension;
  });

  it("perguntas por etapa; preencher só na etapa da aba, inclusive o Preencher todos", async () => {
    const bridge = fakeBridge(() => ({ ok: true, filled: ["f1"], failed: [] }));
    renderApp({
      api: { ...base, getApplication: async () => ({ application: application() }) as never },
      initialUrl: "/candidatura?captura=c1&aba=7",
    });
    const list = await screen.findByRole("list", { name: "Perguntas do formulário" });
    expect(within(list).getByRole("heading", { name: "Etapa 1" })).toBeInTheDocument();
    expect(
      within(list).getByRole("heading", { name: "Etapa 2 · esta página" }),
    ).toBeInTheDocument();
    const [first, second] = within(list).getAllByRole("listitem") as HTMLElement[];
    expect(within(first as HTMLElement).queryByRole("button", { name: "Preencher" })).toBeNull();
    expect(first).toHaveTextContent("Ana Maria Exemplo");
    expect(within(second as HTMLElement).getByRole("button", { name: "Preencher" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Preencher todos" }));
    await waitFor(() => expect(bridge.seen).toHaveLength(1));
    expect(bridge.seen[0]).toMatchObject({
      type: "narnia.fill",
      url: "https://jobs.acme.example/apply/2",
      items: [{ ref: "f1", value: "Campinas" }],
    });
    bridge.stop();
  });

  it("formulário de uma etapa só: sem os títulos das etapas", async () => {
    renderApp({
      api: {
        ...base,
        getApplication: async () =>
          ({
            application: application({
              currentStep: 1,
              steps: [application().steps[0]],
              questions: [application().questions[0]],
            }),
          }) as never,
      },
      initialUrl: "/candidatura?captura=c1",
    });
    const list = await screen.findByRole("list", { name: "Perguntas do formulário" });
    expect(within(list).queryByRole("heading", { name: /^Etapa/ })).toBeNull();
  });

  it("a etapa nova organizando não esconde as perguntas das outras", async () => {
    renderApp({
      api: {
        ...base,
        getApplication: async () =>
          ({
            application: application({
              status: "locating",
              steps: [application().steps[0], { ...application().steps[1], status: "locating" }],
              questions: [application().questions[0]],
            }),
          }) as never,
      },
      initialUrl: "/candidatura?captura=c1",
    });
    expect(await screen.findByText("Organizando as perguntas da etapa 2…")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Perguntas do formulário" });
    expect(within(list).getByText(/Nome completo/)).toBeInTheDocument();
  });

  it("Ler a próxima etapa: lê a mesma aba; página já lida avisa qual etapa ela é", async () => {
    let reply: Record<string, unknown> = { ok: true, applicationId: "a1", step: 3, added: true };
    const bridge = fakeBridge(() => reply);
    renderApp({
      api: { ...base, getApplication: async () => ({ application: application() }) as never },
      initialUrl: "/candidatura?captura=c1&aba=7",
    });
    const next = await screen.findByRole("button", { name: "Ler a próxima etapa nesta aba" });
    await userEvent.click(next);
    await waitFor(() =>
      expect(bridge.seen).toEqual([{ type: "narnia.readForm", tabId: 7, captureId: "c1" }]),
    );
    expect(await screen.findByText("Etapa 3 lida. Organizando as perguntas…")).toBeInTheDocument();
    reply = { ok: true, applicationId: "a1", step: 2, added: false };
    await act(async () => {
      await userEvent.click(next);
    });
    expect(
      await screen.findByText(
        "Esta página é a etapa 2, já lida. Avance no formulário e tente de novo.",
      ),
    ).toBeInTheDocument();
    reply = { ok: false, code: "no_form", error: "Não achei um formulário nesta aba." };
    await userEvent.click(next);
    expect(await screen.findByText("Não achei um formulário nesta aba.")).toBeInTheDocument();
    bridge.stop();
  });

  it("sem a extensão (ou sem a aba), não há Ler a próxima etapa", async () => {
    renderApp({
      api: { ...base, getApplication: async () => ({ application: application() }) as never },
      initialUrl: "/candidatura?captura=c1&aba=7",
    });
    await screen.findByRole("list", { name: "Perguntas do formulário" });
    expect(screen.queryByRole("button", { name: "Ler a próxima etapa nesta aba" })).toBeNull();
  });
});
