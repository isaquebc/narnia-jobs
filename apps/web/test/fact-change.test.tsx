import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { planUsage, proposal, run } from "./f03/fixtures";
import { shellApi } from "./f03/shell-api";
import { renderApp } from "./router-helpers";

/**
 * Alteração pequena pedida na conversa (pedido do dono, 2026-10-23): o recrutador propõe, o usuário confirma ou mantém
 * num cartão com o antes e o depois. O mesmo cartão aparece na conversa e na tela da execução (o link da pendência).
 */
const factChange = {
  kind: "experience" as const,
  factId: "e1",
  label: "Engenheira Sênior · Acme",
  changes: [
    { field: "title", before: "Engenheira Sênior", after: "Tech Lead" },
    { field: "tech", before: ["Go"], after: ["Go", "Kafka"] },
  ],
  reason: "O usuário corrigiu o cargo.",
  quote: "Meu cargo lá era Tech Lead",
  quoteFound: true,
};

const changeRun = (over: Record<string, unknown> = {}) =>
  run({
    source: "text",
    report: null,
    budget: null,
    repos: [],
    factChange,
    proposals: [
      proposal("pp1", {
        proposal: { kind: "experience", confidence: 1, data: {} },
        match: "conflict",
        matchTargetId: "e1",
      }),
    ],
    ...over,
  });

function api(overrides: Record<string, unknown> = {}) {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    getPlanUsage: async () => planUsage(),
    ...overrides,
  };
}

describe("alteração pedida na conversa · cartão de confirmar ou manter", () => {
  it("mostra o fato, o antes e o depois por campo, o motivo e o pedido; confirmar aceita a proposta", async () => {
    const reviewIngestion = vi.fn(async () => ({ pending: 0, runStatus: "done" }));
    renderApp({
      api: api({ getIngestion: async () => changeRun(), reviewIngestion }),
      initialUrl: "/ingestao/r1",
    });
    const card = await screen.findByRole("region", {
      name: "O recrutador quer alterar um dado seu",
    });
    expect(card).toHaveTextContent("Engenheira Sênior · Acme");
    const title = within(card).getByRole("row", { name: /Cargo/ });
    expect(title).toHaveTextContent("Engenheira Sênior");
    expect(title).toHaveTextContent("Tech Lead");
    expect(within(card).getByRole("row", { name: /Tecnologias/ })).toHaveTextContent("Go, Kafka");
    expect(card).toHaveTextContent("O usuário corrigiu o cargo.");
    expect(card).toHaveTextContent("Meu cargo lá era Tech Lead");
    expect(card).toHaveTextContent("Conferido nas suas mensagens");
    // não é a revisão comum de ingestão
    expect(screen.queryByRole("button", { name: /Salvar revisão/ })).toBeNull();
    await userEvent.click(within(card).getByRole("button", { name: "Confirmar alteração" }));
    expect(reviewIngestion).toHaveBeenCalledWith("r1", {
      decisions: [{ proposalId: "pp1", decision: "accepted" }],
    });
  });

  it("manter como estava recusa a proposta", async () => {
    const reviewIngestion = vi.fn(async () => ({ pending: 0, runStatus: "done" }));
    renderApp({
      api: api({ getIngestion: async () => changeRun(), reviewIngestion }),
      initialUrl: "/ingestao/r1",
    });
    const card = await screen.findByRole("region", {
      name: "O recrutador quer alterar um dado seu",
    });
    await userEvent.click(within(card).getByRole("button", { name: "Manter como estava" }));
    await waitFor(() =>
      expect(reviewIngestion).toHaveBeenCalledWith("r1", {
        decisions: [{ proposalId: "pp1", decision: "rejected" }],
      }),
    );
  });

  it("decidida: diz o que aconteceu, sem os botões", async () => {
    renderApp({
      api: api({
        getIngestion: async () =>
          changeRun({
            status: "done",
            proposals: [proposal("pp1", { decision: "accepted", match: "conflict" })],
          }),
      }),
      initialUrl: "/ingestao/r1",
    });
    expect(await screen.findByText("Alteração confirmada.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar alteração" })).toBeNull();
  });
});
