import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { proposal } from "../f03/fixtures";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";
import { message, session } from "./fixtures";

/**
 * Ingestão aberta pela conversa, administrada no painel da direita (pedido do dono, 2026-10-13): progresso, revisão
 * em cards empilhados e um espaço reservado para "Salvar revisão", que só aparece quando há decisão.
 */
const steps = (current: number) =>
  [
    "ingest.read_text",
    "extract.facts",
    "extract.digest",
    "reconcile",
    "review_check",
    "review",
  ].map((key, i) => ({
    key,
    state: i + 1 < current ? "done" : i + 1 === current ? "running" : "pending",
  }));

const skill = (name: string) => ({
  kind: "skill",
  confidence: 0.8,
  data: { name, category: "language" },
});

function chatApi(run: Record<string, unknown> | null, overrides: Record<string, unknown> = {}) {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    listIngestions: async () => ({ runs: [] }),
    listChatSessions: vi.fn(async () => ({ sessions: [session("s1", { title: "Carreira" })] })),
    getChatSession: vi.fn(async (id: string) => ({ session: session(id, { title: "Carreira" }) })),
    listChatMessages: vi.fn(async () => ({
      messages: run
        ? [
            message("a1", {
              contentMd: "Abri a ingestão do seu texto.",
              toolCalls: [
                { name: "ingest_text", args: "{}", durationMs: 5, isError: false, runId: "r1" },
              ],
            }),
          ]
        : [],
    })),
    listResearch: vi.fn(async () => ({ sources: [] })),
    getChatSettings: vi.fn(async () => ({ settings: { maxBudgetUsd: null } })),
    getIngestion: vi.fn(async (id: string) => ({
      id,
      source: "text",
      fileId: "f1",
      jobs: [],
      proposals: [],
      ...run,
    })) as never,
    reviewIngestion: vi.fn(async () => ({ pending: 0, runStatus: "done" })),
    confirmIngestion: vi.fn(async () => ({ status: "queued" as const })),
    getProfileCard: vi.fn(async (id: string) => ({
      profileId: id,
      text: "Ana Maria Exemplo · Campinas",
      tokensEst: 10,
      hash: "h",
      factsVersion: 1,
      builtAt: "2026-10-11T12:00:00.000Z",
      valid: true,
    })),
    ...overrides,
  };
}

describe("ingestão da conversa no painel da direita", () => {
  it("em andamento: card próprio, separado do cartão do perfil, com a etapa e a barra de progresso", async () => {
    renderApp({
      api: chatApi({
        status: "running",
        timeline: { steps: steps(2), current: 2, total: 6, stuck: false },
      }) as never,
      initialUrl: "/chat/s1",
    });
    const panel = await screen.findByRole("region", { name: "Ingestão da conversa" });
    expect(
      await within(panel).findByText("Analisando · etapa 2 de 6: Extrair fatos"),
    ).toBeInTheDocument();
    expect(within(panel).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(within(panel).getByRole("progressbar")).toHaveAttribute("aria-valuemax", "6");
    expect(within(panel).getByRole("link", { name: "Abrir a página da ingestão" })).toHaveAttribute(
      "href",
      "/ingestao/r1",
    );
    // o cartão do perfil continua no painel, fora do card da ingestão
    const aside = screen.getByRole("complementary", { name: "Contexto" });
    expect(within(aside).getByText("Ana Maria Exemplo · Campinas")).toBeInTheDocument();
    expect(within(panel).queryByText("Ana Maria Exemplo · Campinas")).toBeNull();
  });

  it("revisão no painel: cards empilhados; o espaço do salvar existe vazio e o botão aparece com a primeira decisão", async () => {
    const api = chatApi({
      status: "review",
      proposals: [
        proposal("p1", { proposal: skill("Go") }),
        proposal("p2", {
          proposal: skill("Rust"),
          checkStatus: "unsupported",
          checkReason: { layer: 1, code: "quote_not_found" },
        }),
      ],
    });
    renderApp({ api: api as never, initialUrl: "/chat/s1" });
    const panel = await screen.findByRole("region", { name: "Ingestão da conversa" });
    const list = await within(panel).findByRole("list", { name: "Propostas para revisar" });
    const go = within(list).getByRole("listitem", { name: "Go" });
    const rust = within(list).getByRole("listitem", { name: "Rust" });
    expect(
      within(rust).getByText("Motivo: o trecho citado não foi encontrado no texto lido."),
    ).toBeInTheDocument();
    const slot = within(panel).getByTestId("review-save-slot");
    expect(within(slot).queryByRole("button", { name: "Salvar revisão" })).toBeNull();

    await userEvent.click(within(go).getByRole("button", { name: "Aceitar" }));
    await userEvent.click(within(rust).getByRole("button", { name: "Rejeitar" }));
    await userEvent.click(within(slot).getByRole("button", { name: "Salvar revisão" }));
    await waitFor(() =>
      expect(api.reviewIngestion).toHaveBeenCalledWith("r1", {
        decisions: [
          { proposalId: "p1", decision: "accepted" },
          { proposalId: "p2", decision: "rejected" },
        ],
      }),
    );
  });

  it("aguardando confirmação: estimativa e 'Confirmar ingestão' no painel", async () => {
    const api = chatApi(
      {
        status: "awaiting_confirmation",
        estimate: { documentTokens: 0, factsTokens: 9000, digestTokens: 3000 },
      },
      { confirmIngestion: vi.fn(async () => ({ status: "queued" as const })) },
    );
    renderApp({ api: api as never, initialUrl: "/chat/s1" });
    const panel = await screen.findByRole("region", { name: "Ingestão da conversa" });
    expect(await within(panel).findByText(/Aguardando sua confirmação/)).toHaveTextContent("12k");
    await userEvent.click(within(panel).getByRole("button", { name: "Confirmar ingestão" }));
    await waitFor(() => expect(api.confirmIngestion).toHaveBeenCalledWith("r1"));
  });

  it("conversa sem ingestão: nenhum card de ingestão", async () => {
    renderApp({ api: chatApi(null) as never, initialUrl: "/chat/s1" });
    await screen.findByRole("complementary", { name: "Contexto" });
    expect(screen.queryByRole("region", { name: "Ingestão da conversa" })).toBeNull();
  });
});

/**
 * Onde cada card entra (pedido do dono, 2026-10-14): informação pessoal, experiência (do perfil ou nova desta
 * ingestão), skill…; a conquista sem experiência pede a escolha antes de salvar; a ingestão diz de onde veio.
 */
describe("revisão: onde cada card entra e de onde veio a ingestão", () => {
  const ach = (text: string, data: Record<string, unknown> = {}) => ({
    kind: "achievement",
    confidence: 0.8,
    data: { text, ...data },
  });
  const run = {
    status: "review",
    createdAt: "2026-10-14T13:20:00.000Z",
    origin: {
      name: null,
      excerpt: "Na Acme eu liderei 7 pessoas…",
      chatTitle: "Liderança na Acme",
    },
    profileExperiences: [
      { id: "e1", label: "Tech Lead · Acme · 2022-01–atual" },
      { id: "e2", label: "Dev · Beta · 2019–2021" },
    ],
    proposals: [
      proposal("p1", {
        proposal: { kind: "identity", confidence: 0.9, data: { city: "Campinas" } },
        reference: { existing: null, experience: null },
      }),
      proposal("p2", {
        proposal: {
          kind: "experience",
          confidence: 0.9,
          data: {
            company: "Zeta",
            title: "SRE",
            startDate: "2018",
            endDate: "2019",
            isCurrent: false,
            tech: [],
          },
        },
        reference: { existing: null, experience: null },
      }),
      proposal("p3", {
        proposal: ach("Liderou 7 pessoas", { experienceId: "e1" }),
        reference: {
          existing: null,
          experience: {
            source: "profile",
            label: "Tech Lead · Acme · 2022-01–atual",
            experienceId: "e1",
          },
        },
      }),
      proposal("p4", {
        proposal: ach("Automatizou o plantão", { experienceIndex: 0 }),
        reference: {
          existing: null,
          experience: {
            source: "run",
            label: "SRE · Zeta · 2018–2019",
            proposalId: "p2",
            experienceIndex: 0,
          },
        },
      }),
      proposal("p5", {
        proposal: ach("Criou o guia de onboarding"),
        reference: { existing: null, experience: null },
      }),
      proposal("p6", {
        proposal: skill("Go"),
        match: "existing",
        matchTargetId: "s1",
        reference: { existing: "Go", experience: null },
      }),
    ],
  };

  it("cada card diz onde entra; a origem diz o texto e a conversa", async () => {
    renderApp({ api: chatApi(run) as never, initialUrl: "/chat/s1" });
    const panel = await screen.findByRole("region", { name: "Ingestão da conversa" });
    const list = await within(panel).findByRole("list", { name: "Propostas para revisar" });
    expect(within(panel).getByTestId("review-origin")).toHaveTextContent(
      "Origem: Texto: “Na Acme eu liderei 7 pessoas…” · conversa “Liderança na Acme”",
    );
    const ref = (name: string) =>
      within(within(list).getByRole("listitem", { name })).getByTestId("entry-reference");
    expect(ref("Campinas")).toHaveTextContent(
      "Entra em: Informações pessoais › nome, contato e localização",
    );
    expect(ref("SRE · Zeta · 2018–2019")).toHaveTextContent(
      "Entra em: Experiências › nova experiência",
    );
    expect(ref("Liderou 7 pessoas")).toHaveTextContent(
      "Entra em: Experiências › Tech Lead · Acme · 2022-01–atual › conquistas",
    );
    expect(ref("Automatizou o plantão")).toHaveTextContent(
      "Entra em: Experiências › SRE · Zeta · 2018–2019 (nova, desta ingestão) › conquistas",
    );
    expect(ref("Criou o guia de onboarding")).toHaveTextContent(
      "Entra em: Conquistas › sem experiência definida: escolha abaixo",
    );
    expect(ref("Go")).toHaveTextContent("Entra em: Skills › linguagens › Go (já está no perfil)");
  });

  it("conquista aceita sem experiência (ou presa a uma experiência rejeitada) bloqueia o salvar até escolher", async () => {
    const api = chatApi(run);
    renderApp({ api: api as never, initialUrl: "/chat/s1" });
    const panel = await screen.findByRole("region", { name: "Ingestão da conversa" });
    const list = await within(panel).findByRole("list", { name: "Propostas para revisar" });
    const item = (name: string) => within(list).getByRole("listitem", { name });
    const slot = within(panel).getByTestId("review-save-slot");

    await userEvent.click(
      within(item("Criou o guia de onboarding")).getByRole("button", { name: "Aceitar" }),
    );
    expect(
      within(panel).getByText("Escolha a experiência de cada conquista aceita antes de salvar."),
    ).toBeInTheDocument();
    expect(within(slot).getByRole("button", { name: "Salvar revisão" })).toBeDisabled();
    await userEvent.selectOptions(
      within(item("Criou o guia de onboarding")).getByRole("combobox", {
        name: "Experiência da conquista",
      }),
      "Dev · Beta · 2019–2021",
    );
    expect(within(slot).getByRole("button", { name: "Salvar revisão" })).toBeEnabled();
    expect(
      within(item("Criou o guia de onboarding")).getByTestId("entry-reference"),
    ).toHaveTextContent("Experiências › Dev · Beta · 2019–2021 › conquistas");

    // a experiência nova é rejeitada: a conquista dela precisa de outra
    await userEvent.click(
      within(item("SRE · Zeta · 2018–2019")).getByRole("button", { name: "Rejeitar" }),
    );
    await userEvent.click(
      within(item("Automatizou o plantão")).getByRole("button", { name: "Aceitar" }),
    );
    expect(within(slot).getByRole("button", { name: "Salvar revisão" })).toBeDisabled();
    await userEvent.selectOptions(
      within(item("Automatizou o plantão")).getByRole("combobox", {
        name: "Experiência da conquista",
      }),
      "Tech Lead · Acme · 2022-01–atual",
    );
    await userEvent.click(within(slot).getByRole("button", { name: "Salvar revisão" }));
    await waitFor(() =>
      expect(api.reviewIngestion).toHaveBeenCalledWith("r1", {
        decisions: [
          { proposalId: "p2", decision: "rejected" },
          { proposalId: "p4", decision: "edited", editedData: { experienceId: "e1" } },
          { proposalId: "p5", decision: "edited", editedData: { experienceId: "e2" } },
        ],
      }),
    );
  });
});
