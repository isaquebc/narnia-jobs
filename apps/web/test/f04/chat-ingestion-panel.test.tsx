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
