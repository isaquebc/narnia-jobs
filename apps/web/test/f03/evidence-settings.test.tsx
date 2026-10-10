import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "../router-helpers";
import { analysis, githubAuth, ingestSettings, repo, repoDetail, runSummary } from "./fixtures";
import { shellApi } from "./shell-api";

function api(overrides: Record<string, unknown> = {}) {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    getGithubAuth: async () => githubAuth(),
    ...overrides,
  };
}

describe("F03/M4 · Evidências › Repositórios", () => {
  it("lista com relevância, último commit analisado e link para o detalhe", async () => {
    renderApp({
      api: api({
        listRepos: async () => ({
          repos: [
            repo(),
            repo({
              id: "rp2",
              fullName: "ana-exemplo/cli",
              lastAnalysisId: null,
              relevance: null,
              headSha: null,
            }),
          ],
        }),
      }),
      initialUrl: "/evidencias/repositorios",
    });
    const list = await screen.findByRole("list", { name: "Repositórios analisados" });
    const first = within(list).getByRole("listitem", { name: "ana-exemplo/api-pagamentos" });
    expect(within(first).getByText("Relevância 80%")).toBeInTheDocument();
    expect(within(first).getByText("commit abc1234")).toBeInTheDocument();
    expect(within(first).getByRole("link", { name: "Ver detalhes" })).toHaveAttribute(
      "href",
      "/evidencias/repositorios/rp1",
    );
    expect(within(list).getByText("Ainda não analisado")).toBeInTheDocument();
  });

  it("estado vazio aponta para a ingestão", async () => {
    renderApp({
      api: api({ listRepos: async () => ({ repos: [] }) }),
      initialUrl: "/evidencias/repositorios",
    });
    expect(await screen.findByText("Nenhum repositório analisado ainda.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Analisar o GitHub" })).toHaveAttribute(
      "href",
      "/ingestao",
    );
  });
});

describe("F03/M4 · Evidências › detalhe do repositório", () => {
  it("relatório, métricas, histórico, digest editável", async () => {
    const putRepoDigest = vi.fn(async () => ({ digest: repoDetail().digest }));
    renderApp({
      api: api({ getRepo: async () => repoDetail(), putRepoDigest }),
      initialUrl: "/evidencias/repositorios/rp1",
    });
    expect(
      await screen.findByRole("heading", { name: "ana-exemplo/api-pagamentos" }),
    ).toBeInTheDocument();
    const rep = screen.getByRole("region", { name: "Relatório do repositório" });
    expect(
      within(rep).getByText("Serviço de pagamentos em TypeScript com testes de integração."),
    ).toBeInTheDocument();
    expect(within(rep).getByText("Idempotência nas cobranças")).toBeInTheDocument();
    expect(within(rep).getByText("Sem CI configurado")).toBeInTheDocument();
    expect(within(rep).getByText("Publicar um SDK open source do cliente")).toBeInTheDocument();
    const met = screen.getByRole("region", { name: "Métricas" });
    expect(within(met).getByText("Commits")).toBeInTheDocument();
    expect(within(met).getByText("120")).toBeInTheDocument();
    expect(within(met).getByText("PRs mergeados")).toBeInTheDocument();
    const hist = screen.getByRole("list", { name: "Histórico de análises" });
    expect(within(hist).getByText(/Completa · Equilibrada · commit abc1234/)).toBeInTheDocument();
    const dig = screen.getByRole("region", { name: "Resumo do repositório" });
    expect(
      within(dig).getByText("API de pagamentos com cobranças idempotentes."),
    ).toBeInTheDocument();
    await userEvent.click(within(dig).getByRole("button", { name: "Editar resumo" }));
    const box = within(dig).getByRole("textbox", { name: "Resumo" });
    await userEvent.clear(box);
    await userEvent.type(box, "Resumo corrigido.");
    await userEvent.click(within(dig).getByRole("button", { name: "Salvar resumo" }));
    expect(putRepoDigest).toHaveBeenCalledWith("rp1", {
      summary: "Resumo corrigido.",
      keyPoints: ["TypeScript", "Postgres"],
      sections: [],
      meta: { language: "pt", chars: 1200 },
    });
  });

  it("reanalisar oferece atualizar, aprofundar ou cobrir o que ficou de fora", async () => {
    const reanalyzeRepo = vi.fn(async () =>
      runSummary({ id: "r7", status: "awaiting_confirmation" }),
    );
    const { router } = renderApp({
      api: api({
        getRepo: async () => repoDetail(),
        reanalyzeRepo,
        getIngestion: async () => ({ ...(await import("./fixtures")).run({ id: "r7" }) }),
        getPlanUsage: async () => ({ usage: null }),
      }),
      initialUrl: "/evidencias/repositorios/rp1",
    });
    await userEvent.click(await screen.findByRole("button", { name: "Reanalisar" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Reanalisar ana-exemplo/api-pagamentos",
    });
    expect(within(dialog).getByText("Já lido: 2 arquivos, 1 tema.")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("radio", { name: /Atualizar com os commits novos/ }),
    ).toBeChecked();
    await userEvent.click(
      within(dialog).getByRole("radio", { name: /Cobrir o que ficou de fora/ }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Criar reanálise" }));
    expect(reanalyzeRepo).toHaveBeenCalledWith("rp1", { kind: "cover" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/ingestao/r7"));
  });

  it("sem análise concluída, o histórico fica vazio", async () => {
    renderApp({
      api: api({ getRepo: async () => repoDetail({ analyses: [], digest: null, metrics: null }) }),
      initialUrl: "/evidencias/repositorios/rp1",
    });
    expect(await screen.findByText("Nenhuma análise concluída ainda.")).toBeInTheDocument();
    expect(analysis).toBeDefined();
  });
});

describe("F03/M4 · Configurações › Integrações", () => {
  it("revisor anti-alucinação, limiar de autoconfirmação, padrões de orçamento e teto de snapshots", async () => {
    const putIngestSettings = vi.fn(async (b: Record<string, unknown>) => ingestSettings(b));
    const deleteSnapshot = vi.fn(async () => ({ ok: true as const }));
    renderApp({
      api: api({
        getIngestSettings: async () => ingestSettings(),
        putIngestSettings,
        listSnapshots: async () => ({
          snapshots: [
            {
              id: "s1",
              source: "github",
              ref: "ana-exemplo/api-pagamentos",
              headSha: "abc1234def",
              size: 1_258_291,
              takenAt: "2026-10-09T12:00:00.000Z",
              lastUsedAt: null,
            },
          ],
          totalBytes: 1_258_291,
          maxBytes: 2 * 1024 ** 3,
        }),
        deleteSnapshot,
      }),
      initialUrl: "/configuracoes",
    });
    expect(await screen.findByRole("heading", { name: "Configurações" })).toBeInTheDocument();
    expect(await screen.findByText("Conectado como @ana-exemplo")).toBeInTheDocument();
    const check = await screen.findByRole("switch", {
      name: "Revisor anti-alucinação (modelo mais barato)",
    });
    expect(check).toBeChecked();
    await userEvent.click(check);
    const auto = screen.getByLabelText("Seguir sozinho abaixo de (mil tokens)");
    expect(auto).toHaveValue(10);
    await userEvent.clear(auto);
    await userEvent.type(auto, "0");
    const deep = screen.getByLabelText("Profunda (mil tokens)");
    expect(deep).toHaveValue(150);
    await userEvent.clear(deep);
    await userEvent.type(deep, "200");
    const cap = screen.getByLabelText("Teto dos snapshots (GB)");
    expect(cap).toHaveValue(2);
    await userEvent.clear(cap);
    await userEvent.type(cap, "5");
    await userEvent.click(screen.getByRole("button", { name: "Salvar configurações" }));
    expect(putIngestSettings).toHaveBeenCalledWith({
      reviewCheckModelEnabled: false,
      autoConfirmBelow: 0,
      budgetUnit: "thousand",
      budgetDefaults: { quick: 15_000, balanced: 50_000, deep: 200_000 },
      snapshotsMaxBytes: 5 * 1024 ** 3,
    });
    expect(await screen.findByText("Configurações salvas.")).toBeInTheDocument();
    const snaps = screen.getByRole("region", { name: "Snapshots" });
    expect(within(snaps).getByText("Em uso: 1.2 MB de 2.0 GB")).toBeInTheDocument();
    await userEvent.click(
      within(snaps).getByRole("button", { name: "Apagar snapshot de ana-exemplo/api-pagamentos" }),
    );
    expect(deleteSnapshot).toHaveBeenCalledWith("s1");
  });
});

describe("F03-fix L1 · Configurações › Backups (FX-2)", () => {
  it("mostra o teto (no máximo N cópias), o backup mais recente e grava o teto novo", async () => {
    const putBackupSettings = vi.fn(async (b: { max: number }) => ({
      max: b.max,
      enabled: true,
      latest: {
        file: "narnia-boot-2026-10-10T11-00-00-000Z.sqlite",
        at: "2026-10-10T11:00:00.000Z",
      },
      count: 2,
    }));
    renderApp({
      api: api({
        getIngestSettings: async () => ingestSettings(),
        listSnapshots: async () => ({ snapshots: [], totalBytes: 0, maxBytes: 2 * 1024 ** 3 }),
        getBackupSettings: async () => ({
          max: 5,
          enabled: true,
          latest: {
            file: "narnia-boot-2026-10-10T11-00-00-000Z.sqlite",
            at: "2026-10-10T11:00:00.000Z",
          },
          count: 2,
        }),
        putBackupSettings,
      }),
      initialUrl: "/configuracoes",
    });
    const region = await screen.findByRole("region", { name: "Backups" });
    expect(
      await within(region).findByText("Último backup: 10/10/2026 08:00 · 2 cópias"),
    ).toBeInTheDocument();
    const max = within(region).getByLabelText("Máximo de backups");
    expect(max).toHaveValue(5);
    expect(max).toHaveAttribute("min", "1");
    await userEvent.clear(max);
    await userEvent.type(max, "3");
    await userEvent.click(within(region).getByRole("button", { name: "Salvar backups" }));
    await waitFor(() => expect(putBackupSettings).toHaveBeenCalledWith({ max: 3 }));
    expect(await within(region).findByText("Backups salvos.")).toBeInTheDocument();
  });

  it("sem backup ainda e com backups desligados, explica", async () => {
    renderApp({
      api: api({
        getIngestSettings: async () => ingestSettings(),
        listSnapshots: async () => ({ snapshots: [], totalBytes: 0, maxBytes: 2 * 1024 ** 3 }),
        getBackupSettings: async () => ({ max: 5, enabled: false, latest: null, count: 0 }),
      }),
      initialUrl: "/configuracoes",
    });
    const region = await screen.findByRole("region", { name: "Backups" });
    expect(
      await within(region).findByText("Backups desligados nesta instância."),
    ).toBeInTheDocument();
  });
});
