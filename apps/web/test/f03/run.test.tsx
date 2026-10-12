import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "../router-helpers";
import { planUsage, proposal, report, run } from "./fixtures";
import { shellApi } from "./shell-api";

function api(overrides: Record<string, unknown> = {}) {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    getPlanUsage: async () => planUsage(),
    ...overrides,
  };
}

describe("F03/M4 · execução › confirmação, progresso, erro", () => {
  it("aguardando confirmação: mostra o orçamento e confirma", async () => {
    const confirmIngestion = vi.fn(async () => ({ status: "queued" }));
    renderApp({
      api: api({
        getIngestion: async () => run({ status: "awaiting_confirmation", report: null }),
        confirmIngestion,
      }),
      initialUrl: "/ingestao/r1",
    });
    expect(await screen.findByText("Aguardando confirmação")).toBeInTheDocument();
    expect(
      screen.getByText("Orçamento: 15k tokens · fatia por repositório: 3.3k"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirmar e iniciar" }));
    expect(confirmIngestion).toHaveBeenCalledWith("r1");
  });

  it("analisando: progresso por repositório e uso real contra o orçamento; cancelar", async () => {
    const cancelIngestion = vi.fn(async () => ({ status: "cancelled" }));
    renderApp({
      api: api({
        getIngestion: async () =>
          run({
            status: "running",
            report: report({
              repos: [
                { fullName: "a/x", estimatedTokens: 4000, usedTokens: 4400, status: "done" },
                { fullName: "a/y", estimatedTokens: 4000, usedTokens: 4800, status: "running" },
                { fullName: "a/z", estimatedTokens: 4000, usedTokens: 0, status: "pending" },
              ],
            }),
          }),
        cancelIngestion,
      }),
      initialUrl: "/ingestao/r1",
    });
    expect(await screen.findByText("1 de 3 repositórios analisados")).toBeInTheDocument();
    expect(screen.getByText("Uso: 9.2k de 15k tokens")).toBeInTheDocument();
    const rows = screen.getByRole("list", { name: "Repositórios da execução" });
    expect(within(rows).getByText("a/y")).toBeInTheDocument();
    expect(within(rows).getByText("Em análise")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar execução" }));
    expect(cancelIngestion).toHaveBeenCalledWith("r1");
  });

  it("erro do GitHub oferece tentar de novo", async () => {
    const retryIngestion = vi.fn(async () => ({ status: "estimating" }));
    renderApp({
      api: api({
        getIngestion: async () => run({ status: "error", error: "GitHub fora do ar" }),
        retryIngestion,
      }),
      initialUrl: "/ingestao/r1",
    });
    expect(await screen.findByText("GitHub fora do ar")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(retryIngestion).toHaveBeenCalledWith("r1");
  });
});

describe("F03/M4 · execução › freio do orçamento", () => {
  it("mostra gasto × estimado, janela e custo para terminar; continuar com orçamento extra", async () => {
    const decideIngestion = vi.fn(async () => ({ status: "running" }));
    renderApp({
      api: api({ getIngestion: async () => run({ status: "awaiting_decision" }), decideIngestion }),
      initialUrl: "/ingestao/r1",
    });
    const dialog = await screen.findByRole("dialog", { name: "Orçamento esgotado" });
    expect(
      within(dialog).getByText("Gasto: 9.2k tokens · estimado: 15.1k tokens"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Para terminar: ~4k tokens (1 repositório)"),
    ).toBeInTheDocument();
    expect(await within(dialog).findByText(/Janela de 5 horas: 35% usado/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Orçamento extra (mil tokens)")).toHaveValue(4);
    await userEvent.click(within(dialog).getByRole("button", { name: "Continuar" }));
    expect(decideIngestion).toHaveBeenCalledWith("r1", { action: "continue", extraBudget: 4000 });
  });

  it("encerrar com o que já foi feito e deixar para depois", async () => {
    const decideIngestion = vi.fn(async () => ({ status: "review" }));
    renderApp({
      api: api({ getIngestion: async () => run({ status: "awaiting_decision" }), decideIngestion }),
      initialUrl: "/ingestao/r1",
    });
    const dialog = await screen.findByRole("dialog", { name: "Orçamento esgotado" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Deixar para depois" }));
    expect(decideIngestion).toHaveBeenCalledWith("r1", { action: "later" });
    await userEvent.click(
      await screen.findByRole("button", { name: "Encerrar com o que já foi feito" }),
    );
    expect(decideIngestion).toHaveBeenCalledWith("r1", { action: "finish" });
  });

  it("pausada: retomar reabre a decisão", async () => {
    const decideIngestion = vi.fn(async () => ({ status: "running" }));
    renderApp({
      api: api({ getIngestion: async () => run({ status: "paused" }), decideIngestion }),
      initialUrl: "/ingestao/r1",
    });
    expect(await screen.findByText("Pausada")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retomar" }));
    expect(await screen.findByRole("dialog", { name: "Orçamento esgotado" })).toBeInTheDocument();
  });
});

const conflictProposal = proposal("p2", {
  proposal: {
    kind: "experience",
    confidence: 0.8,
    data: { company: "Acme", title: "Tech Lead", startDate: "2021-01" },
  },
  match: "conflict",
  matchTargetId: "e1",
  conflict: {
    targetId: "e1",
    fields: [
      {
        field: "title",
        current: "Engenheira Sênior",
        proposed: "Tech Lead",
        currentSource: "cv",
        proposedSource: "github",
      },
    ],
  },
  checkStatus: "partial",
});
const unsupported = proposal("p3", {
  proposal: { kind: "skill", confidence: 0.6, data: { name: "Kubernetes", category: "infra" } },
  match: "existing",
  checkStatus: "unsupported",
  evidence: { ref: "src/x.ts", quote: "kubectl apply" },
});

describe("F03/M4 · execução › revisão estendida", () => {
  it("selos de verificação com trecho, filtros, conflito bloqueia salvar, tags por perfil e envio", async () => {
    const reviewIngestion = vi.fn(async () => ({ pending: 1, runStatus: "review" }));
    renderApp({
      api: api({
        getIngestion: async () =>
          run({
            status: "review",
            proposals: [
              proposal("p1", { suggestedProfiles: ["p1"] }),
              conflictProposal,
              unsupported,
            ],
          }),
        reviewIngestion,
      }),
      initialUrl: "/ingestao/r1",
    });
    const row1 = await screen.findByRole("listitem", { name: "api-pagamentos" });
    expect(within(row1).getByText("Sustentada")).toBeInTheDocument();
    expect(within(row1).getByText("Novo")).toBeInTheDocument();
    await userEvent.click(within(row1).getByText("Ver trecho"));
    expect(within(row1).getByText("“API de pagamentos com Postgres”")).toBeInTheDocument();
    expect(within(row1).getByText("README.md")).toBeInTheDocument();
    expect(within(row1).getByRole("checkbox", { name: "Destacar em Eng" })).toBeChecked();
    const row3 = screen.getByRole("listitem", { name: "Kubernetes" });
    expect(within(row3).getByText("Sem suporte")).toBeInTheDocument();
    expect(within(row3).getByText("Já existe")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Conflitos (1)" }));
    expect(screen.queryByRole("listitem", { name: "api-pagamentos" })).toBeNull();
    const row2 = screen.getByRole("listitem", { name: "Tech Lead · Acme · 2021-01" });
    expect(within(row2).getByText("Conflito")).toBeInTheDocument();
    await userEvent.click(within(row2).getByRole("button", { name: "Aceitar" }));
    const resolver = within(row2).getByRole("group", { name: "Resolver: title" });
    expect(within(resolver).getByText(/Engenheira Sênior/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar revisão" })).toBeDisabled();
    expect(screen.getByText("Resolva os conflitos aceitos antes de salvar.")).toBeInTheDocument();
    await userEvent.click(within(resolver).getByRole("radio", { name: /Manter atual/ }));

    await userEvent.click(screen.getByRole("radio", { name: "Todas (3)" }));
    await userEvent.click(
      within(screen.getByRole("listitem", { name: "api-pagamentos" })).getByRole("button", {
        name: "Aceitar",
      }),
    );
    expect(screen.getByRole("button", { name: "Salvar revisão" })).toBeEnabled();
    // F04: a clarificação passou a funcionar (era desabilitada até o chat existir)
    expect(screen.getByRole("button", { name: "Clarificar com o recrutador" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Salvar revisão" }));
    expect(reviewIngestion).toHaveBeenCalledWith("r1", {
      decisions: [
        { proposalId: "p1", decision: "accepted", profiles: ["p1"] },
        { proposalId: "p2", decision: "accepted", resolution: { title: { choice: "keep" } } },
      ],
    });
  });

  it("editar no conflito exige valor; rejeitar não exige resolução", async () => {
    const reviewIngestion = vi.fn(async () => ({ pending: 0, runStatus: "done" }));
    renderApp({
      api: api({
        getIngestion: async () =>
          run({ status: "review", proposals: [conflictProposal, unsupported] }),
        reviewIngestion,
      }),
      initialUrl: "/ingestao/r1",
    });
    const row2 = await screen.findByRole("listitem", { name: "Tech Lead · Acme · 2021-01" });
    await userEvent.click(within(row2).getByRole("button", { name: "Aceitar" }));
    const resolver = within(row2).getByRole("group", { name: "Resolver: title" });
    await userEvent.click(within(resolver).getByRole("radio", { name: "Editar" }));
    expect(screen.getByRole("button", { name: "Salvar revisão" })).toBeDisabled();
    await userEvent.type(within(resolver).getByLabelText("Novo valor de title"), "Staff Engineer");
    await userEvent.click(
      within(screen.getByRole("listitem", { name: "Kubernetes" })).getByRole("button", {
        name: "Rejeitar",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Salvar revisão" }));
    expect(reviewIngestion).toHaveBeenCalledWith("r1", {
      decisions: [
        {
          proposalId: "p2",
          decision: "accepted",
          resolution: { title: { choice: "edit", value: "Staff Engineer" } },
        },
        { proposalId: "p3", decision: "rejected" },
      ],
    });
  });

  it("marcar perfis em lote aplica aos aceitos", async () => {
    const reviewIngestion = vi.fn(async () => ({ pending: 0, runStatus: "done" }));
    renderApp({
      api: api({
        getIngestion: async () =>
          run({ status: "review", proposals: [proposal("p1"), unsupported] }),
        reviewIngestion,
      }),
      initialUrl: "/ingestao/r1",
    });
    await screen.findByRole("listitem", { name: "api-pagamentos" });
    await userEvent.click(screen.getByRole("button", { name: "Aceitar todos" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Destacar os aceitos em Eng" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar revisão" }));
    expect(reviewIngestion).toHaveBeenCalledWith("r1", {
      decisions: [
        { proposalId: "p1", decision: "accepted", profiles: ["p1"] },
        { proposalId: "p3", decision: "accepted", profiles: ["p1"] },
      ],
    });
  });
});

describe("F03/M4 · execução › relatório", () => {
  it("concluída: estimado × usado, por repositório, paradas e síntese", async () => {
    renderApp({
      api: api({
        getIngestion: async () =>
          run({
            status: "done",
            proposals: [],
            report: report({ synthesis: "Perfil forte em back-end de pagamentos." }),
          }),
      }),
      initialUrl: "/ingestao/r1",
    });
    const rep = await screen.findByRole("region", { name: "Relatório da execução" });
    expect(within(rep).getByText("Estimado: 15.1k · usado: 9.2k tokens")).toBeInTheDocument();
    expect(within(rep).getByText("Perfil forte em back-end de pagamentos.")).toBeInTheDocument();
    expect(within(rep).getByText("acme-labs/plataforma")).toBeInTheDocument();
    expect(within(rep).getByText(/Parada por orçamento/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Finalizada")).toBeInTheDocument());
  });
});
