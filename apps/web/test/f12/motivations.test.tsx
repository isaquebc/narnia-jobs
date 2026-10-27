import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";

/**
 * F12-23 (pedido do dono, 2026-10-26) · motivações do perfil na janela do formulário: sem elas revisadas, a janela
 * pergunta antes de escrever as respostas (aceitar, editar ou recusar; a recusada gera outra), com a forma de
 * tratamento; nas respostas, cada suposição do roleplay pode ser aceita, editada ou recusada.
 */
const capture = {
  id: "c1",
  url: "https://acme.example/aplicar",
  title: "Candidatura",
  createdAt: "2026-10-26T12:00:00.000Z",
  postingId: "v1",
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
    message: "",
  },
};

const motivation = (id: string, text: string, status: string) => ({
  id,
  profileId: "p1",
  text,
  status,
  source: "model",
  assumption: null,
  createdAt: "2026-10-26T12:00:00.000Z",
  updatedAt: "2026-10-26T12:00:00.000Z",
});

const question = (assumptions: string[], assumptionStatus: Array<string | null>) => ({
  id: "q1",
  question: "Why Vitalis?",
  kind: "long_text",
  options: [],
  required: true,
  maxChars: null,
  fieldRefs: ["f1"],
  section: null,
  profileField: null,
  topic: null,
  source: "model",
  prefill: null,
  assumptionStatus,
  answer: {
    questionId: "q1",
    version: 1,
    answer: "I want to bring payments to health.",
    origins: [],
    gap: null,
    assumptions,
    source: "roleplay",
    createdAt: "2026-10-26T12:00:00.000Z",
  },
});

const form = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  captureId: "c1",
  url: "https://acme.example/aplicar",
  title: null,
  status: "ready",
  error: null,
  warning: null,
  postingId: "v1",
  posting: { title: "Backend Sr", company: "Vitalis" },
  profileId: "p1",
  answersStatus: "ready",
  answersError: null,
  answersProfileId: "p1",
  chatSessionId: null,
  createdAt: "2026-10-26T12:00:00.000Z",
  updatedAt: "2026-10-26T12:00:00.000Z",
  questions: [],
  ...over,
});

const base = {
  ...shellApi,
  getExtensionCapture: async () => ({ capture }) as never,
  getPosting: async () =>
    ({ posting: { id: "v1" }, contacts: [], notes: [], duplicates: [] }) as never,
  listPostingAnalyses: async () => ({ analyses: [] }),
  listDocuments: async () => ({ documents: [] }) as never,
  getUser: async () => ({ user: { pronouns: null } }) as never,
};

describe("F12-23 · motivações antes das respostas", () => {
  it("decide as sugestões (aceitar, editar, recusar), escreve a sua, escolhe o tratamento e segue para as respostas", async () => {
    const patchMotivation = vi.fn(async () => ({ motivation: {} }) as never);
    const addMotivation = vi.fn(async () => ({ motivation: {} }) as never);
    const reviewMotivations = vi.fn(async () => ({ reviewed: true }));
    const setAddressForm = vi.fn(async () => ({ user: {} }) as never);
    renderApp({
      api: {
        ...base,
        getApplication: async () =>
          ({ application: form({ answersStatus: "motivations" }) }) as never,
        listMotivations: async () => ({
          items: [
            motivation("m1", "Quero continuar trabalhando com pagamentos.", "suggested"),
            motivation("m2", "Gosto de ser dona dos serviços.", "suggested"),
            motivation("m3", "Prefiro times pequenos.", "suggested"),
            motivation("m4", "Quero trabalhar em startup.", "refused"),
          ],
          reviewed: false,
          suggesting: false,
        }),
        patchMotivation,
        addMotivation,
        reviewMotivations,
        setAddressForm,
      } as never,
      initialUrl: "/candidatura?captura=c1",
    });
    const step = await screen.findByRole("region", { name: "Antes das respostas: o que te move" });
    const items = within(within(step).getByRole("list", { name: "Motivações" })).getAllByRole(
      "listitem",
    );
    expect(items).toHaveLength(3); // a recusada não aparece como sugestão
    await userEvent.click(within(items[0] as HTMLElement).getByRole("button", { name: "Aceitar" }));
    expect(patchMotivation).toHaveBeenCalledWith("p1", "m1", { status: "accepted" });
    await userEvent.click(within(items[2] as HTMLElement).getByRole("button", { name: "Recusar" }));
    expect(patchMotivation).toHaveBeenCalledWith("p1", "m3", { status: "refused" });
    await userEvent.click(within(items[1] as HTMLElement).getByRole("button", { name: "Editar" }));
    const box = within(items[1] as HTMLElement).getByRole("textbox", { name: "Motivação" });
    await userEvent.clear(box);
    await userEvent.type(box, "Gosto de cuidar dos serviços de ponta a ponta.");
    await userEvent.click(within(items[1] as HTMLElement).getByRole("button", { name: "Salvar" }));
    expect(patchMotivation).toHaveBeenCalledWith("p1", "m2", {
      text: "Gosto de cuidar dos serviços de ponta a ponta.",
    });
    await userEvent.type(
      within(step).getByRole("textbox", { name: "Escreva uma frase sua" }),
      "Quero trabalhar perto do produto.",
    );
    await userEvent.click(within(step).getByRole("button", { name: "Adicionar" }));
    expect(addMotivation).toHaveBeenCalledWith("p1", "Quero trabalhar perto do produto.");
    await userEvent.selectOptions(
      within(step).getByRole("combobox", { name: "Como o narnia se refere a você" }),
      "feminino",
    );
    expect(setAddressForm).toHaveBeenCalledWith("feminino");
    await userEvent.click(within(step).getByRole("button", { name: "Escrever as respostas" }));
    await waitFor(() => expect(reviewMotivations).toHaveBeenCalledWith("p1"));
  });

  it("enquanto o narnia sugere, mostra o andamento", async () => {
    renderApp({
      api: {
        ...base,
        getApplication: async () =>
          ({ application: form({ answersStatus: "motivations" }) }) as never,
        listMotivations: async () => ({ items: [], reviewed: false, suggesting: true }),
      } as never,
      initialUrl: "/candidatura?captura=c1",
    });
    expect(await screen.findByText("Sugerindo frases pelo seu histórico…")).toBeInTheDocument();
  });

  it("a sugestão termina sem outro evento (o worker avisa antes de a tarefa acabar): o andamento some sozinho", async () => {
    let suggesting = true;
    renderApp({
      api: {
        ...base,
        getApplication: async () =>
          ({ application: form({ answersStatus: "motivations" }) }) as never,
        listMotivations: async () => ({
          items: [motivation("m1", "Quero continuar trabalhando com pagamentos.", "suggested")],
          reviewed: false,
          suggesting,
        }),
      } as never,
      initialUrl: "/candidatura?captura=c1",
    });
    expect(await screen.findByText("Sugerindo frases pelo seu histórico…")).toBeInTheDocument();
    suggesting = false;
    await waitFor(
      () => expect(screen.queryByText("Sugerindo frases pelo seu histórico…")).toBeNull(),
      { timeout: 4_000 },
    );
  });
});

describe("F12-23 · suposições do roleplay na resposta", () => {
  it("aceitar, editar ou recusar cada uma; a decidida mostra o estado", async () => {
    const app = form({
      questions: [
        question(
          ["Que você quer trabalhar com saúde.", "Que o remoto pesa na sua escolha."],
          [null, "accepted"],
        ),
      ],
    });
    const decideAssumption = vi.fn(async () => ({ application: app }) as never);
    renderApp({
      api: {
        ...base,
        getApplication: async () => ({ application: app }) as never,
        decideAssumption,
      } as never,
      initialUrl: "/candidatura?captura=c1",
    });
    const list = await screen.findByRole("list", { name: "O que o narnia supôs" });
    const [first, second] = within(list).getAllByRole("listitem") as HTMLElement[];
    expect(second).toHaveTextContent("Aceita");
    expect(within(second as HTMLElement).queryByRole("button", { name: "Recusar" })).toBeNull();
    await userEvent.click(within(first as HTMLElement).getByRole("button", { name: "Recusar" }));
    expect(decideAssumption).toHaveBeenCalledWith("a1", "q1", { index: 0, action: "refuse" });
    await userEvent.click(within(first as HTMLElement).getByRole("button", { name: "Editar" }));
    const box = within(first as HTMLElement).getByRole("textbox", { name: "Motivação" });
    expect(box).toHaveValue("Quero trabalhar com saúde.");
    await userEvent.clear(box);
    await userEvent.type(box, "Quero trabalhar com prevenção em saúde.");
    await userEvent.click(within(first as HTMLElement).getByRole("button", { name: "Salvar" }));
    expect(decideAssumption).toHaveBeenCalledWith("a1", "q1", {
      index: 0,
      action: "accept",
      text: "Quero trabalhar com prevenção em saúde.",
    });
    await userEvent.click(within(first as HTMLElement).getByRole("button", { name: "Aceitar" }));
    expect(decideAssumption).toHaveBeenCalledWith("a1", "q1", { index: 0, action: "accept" });
  });
});
