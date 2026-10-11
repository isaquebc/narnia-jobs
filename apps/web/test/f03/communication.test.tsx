import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "../router-helpers";
import { planUsage, report, run, runSummary } from "./fixtures";
import { shellApi } from "./shell-api";

/** Plano de comunicação C1, C2, C3, C5 (2026-10-11): em que ponto está, o que falta, se está viva, o que fazer. */
function api(overrides: Record<string, unknown> = {}) {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    getPlanUsage: async () => planUsage(),
    ...overrides,
  };
}

const steps = (states: string[], extra: Record<number, Record<string, unknown>> = {}) =>
  ["prepare", "repos", "synthesis", "reconcile", "review_check", "review"].map((key, i) => ({
    key,
    state: states[i],
    ...(extra[i] ?? {}),
  }));

describe("Comunicação · linha do tempo e vocabulário", () => {
  it("analisando: o topo diz a etapa ('etapa 5 de 6: Conferir as propostas') e repositório aparece como 'Analisado'", async () => {
    const base = report();
    renderApp({
      api: api({
        getIngestion: async () =>
          run({
            status: "running",
            report: { ...base, repos: base.repos.map((r) => ({ ...r, status: "done" })) },
            timeline: {
              steps: steps(["done", "done", "done", "done", "running", "pending"], {
                1: { progress: { done: 3, total: 3 } },
              }),
              current: 5,
              total: 6,
              stuck: false,
            },
          }),
      }),
      initialUrl: "/ingestao/r1",
    });
    expect(
      await screen.findByText("Analisando · etapa 5 de 6: Conferir as propostas"),
    ).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Etapas da execução" });
    expect(within(list).getByText("Síntese")).toBeInTheDocument();
    expect(within(list).getByText("3 de 3")).toBeInTheDocument();
    expect(screen.queryByText("Concluído")).not.toBeInTheDocument();
    expect(screen.getAllByText("Analisado").length).toBeGreaterThan(0);
  });

  it("etapa sem sinal há mais de 2 minutos aparece como 'Parece parada'", async () => {
    renderApp({
      api: api({
        getIngestion: async () =>
          run({
            status: "running",
            timeline: {
              steps: steps(["done", "done", "stuck", "pending", "pending", "pending"]),
              current: 3,
              total: 6,
              stuck: true,
            },
          }),
      }),
      initialUrl: "/ingestao/r1",
    });
    expect(await screen.findByText("Parece parada · etapa 3 de 6: Síntese")).toBeInTheDocument();
  });

  it("erro: mensagem em português, o que fazer, detalhes técnicos recolhidos e botão que diz o que refaz", async () => {
    const retryIngestion = vi.fn(async () => ({ status: "running" }));
    renderApp({
      api: api({
        getIngestion: async () =>
          run({
            status: "error",
            error: "job stalled more than allowable limit",
            errorFriendly: {
              key: "error.interrupted",
              hint: "error.interrupted_hint",
              technical: "job stalled more than allowable limit",
            },
            failedTaskType: "ingest.github.synthesis",
          }),
        retryIngestion,
      }),
      initialUrl: "/ingestao/r1",
    });
    expect(
      await screen.findByText("A tarefa foi interrompida porque o serviço reiniciou."),
    ).toBeInTheDocument();
    expect(screen.getByText("Refaça esta etapa.")).toBeInTheDocument();
    expect(screen.getByText("Detalhes técnicos")).toBeInTheDocument();
    expect(
      screen.getByText("Os repositórios já analisados não serão refeitos."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refazer a síntese" }));
    expect(retryIngestion).toHaveBeenCalledWith("r1");
  });

  it("pendências mostram a mesma frase de etapa que a página", async () => {
    renderApp({
      api: api({
        listIngestions: async () => ({
          runs: [
            runSummary({
              status: "running",
              progress: { current: 2, total: 6, stepKey: "repos", stuck: false },
            }),
          ],
        }),
      }),
      initialUrl: "/ingestao",
    });
    expect(
      await screen.findByText("Analisando · etapa 2 de 6: Analisar repositórios"),
    ).toBeInTheDocument();
  });

  it("execução pronta para revisão e finalizada usam o vocabulário novo", async () => {
    renderApp({
      api: api({
        listIngestions: async () => ({
          runs: [
            runSummary({ id: "a", status: "review" }),
            runSummary({ id: "b", status: "awaiting_decision" }),
          ],
        }),
      }),
      initialUrl: "/ingestao",
    });
    expect(await screen.findByText("Pronta para revisão")).toBeInTheDocument();
  });
});

describe("Comunicação · bandeja", () => {
  it("execução em andamento aparece na bandeja com a mesma frase de etapa e o link para abrir", async () => {
    renderApp({
      api: api({
        listIngestions: async (q?: { status?: string[] }) => ({
          runs: (q?.status ?? []).includes("running")
            ? [
                runSummary({
                  id: "rx",
                  status: "running",
                  progress: { current: 3, total: 6, stepKey: "synthesis", stuck: false },
                }),
              ]
            : [],
        }),
      }),
      initialUrl: "/dashboard",
    });
    await userEvent.click(await screen.findByRole("button", { name: "Atividades" }));
    const list = await screen.findByRole("list", { name: "Execuções em andamento" });
    expect(within(list).getByText("Analisando · etapa 3 de 6: Síntese")).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "Abrir" })).toHaveAttribute(
      "href",
      "/ingestao/rx",
    );
  });
});
