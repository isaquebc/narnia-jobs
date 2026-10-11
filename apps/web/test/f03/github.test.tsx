import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "../router-helpers";
import {
  estimate,
  githubAuth,
  ingestSettings,
  planUsage,
  preview,
  previewItem,
  run,
  runSummary,
} from "./fixtures";
import { shellApi } from "./shell-api";

const IN_15_MIN = () => new Date(Date.now() + 15 * 60_000).toISOString();

function api(overrides: Record<string, unknown> = {}) {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    listIngestions: async () => ({ runs: [] }),
    getGithubAuth: async () => githubAuth(),
    getIngestSettings: async () => ingestSettings(),
    getPlanUsage: async () => planUsage(),
    previewGithub: vi.fn(async () => preview()),
    estimateIngestion: vi.fn(async () => estimate()),
    getIngestion: async () => run(),
    ...overrides,
  };
}

describe("F03/M4 · GitHub › conexão", () => {
  it("origem host conectada mostra o login e os escopos", async () => {
    renderApp({ api: api(), initialUrl: "/ingestao" });
    expect(await screen.findByText("Conectado como @ana-exemplo")).toBeInTheDocument();
    expect(screen.getByText("Escopos: repo, read:org")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Usar o gh do computador" })).toBeChecked();
  });

  it("host sem gh: avisa e oferece o login próprio do app", async () => {
    const setGithubAuthSource = vi.fn(async () =>
      githubAuth({ source: "app", connected: false, login: null, hostAvailable: false }),
    );
    renderApp({
      api: api({
        getGithubAuth: async () =>
          githubAuth({ connected: false, login: null, scopes: [], hostAvailable: false }),
        setGithubAuthSource,
      }),
      initialUrl: "/ingestao",
    });
    expect(
      await screen.findByText(/Não encontramos o gh logado no seu computador/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Usar login próprio do app" }));
    expect(setGithubAuthSource).toHaveBeenCalledWith("app");
  });

  it("fluxo de dispositivo: código, copiar, abrir GitHub em nova aba e conclusão pelo WS", async () => {
    const startGithubDevice = vi.fn(async () => ({
      code: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      expiresAt: IN_15_MIN(),
    }));
    const { ws } = renderApp({
      api: api({
        getGithubAuth: async () =>
          githubAuth({ source: "app", connected: false, login: null, scopes: [] }),
        startGithubDevice,
      }),
      initialUrl: "/ingestao",
    });
    await userEvent.click(await screen.findByRole("button", { name: "Conectar GitHub" }));
    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument();
    const open = screen.getByRole("link", { name: "Abrir GitHub" });
    expect(open).toHaveAttribute("href", "https://github.com/login/device");
    expect(open).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("button", { name: "Copiar" })).toBeInTheDocument();
    expect(screen.getByText(/Expira em \d{2}:\d{2}/)).toBeInTheDocument();
    ws.emit({
      type: "github.auth_updated",
      status: githubAuth({ source: "app", connected: true, login: "ana-exemplo" }),
    });
    expect(await screen.findByText("Conectado como @ana-exemplo")).toBeInTheDocument();
    expect(screen.queryByText("ABCD-1234")).toBeNull();
    expect(screen.getByRole("button", { name: "Desconectar" })).toBeInTheDocument();
  });

  it("depois de conectar e desconectar, volta a oferecer 'Conectar GitHub' (o código usado não reaparece)", async () => {
    let connected = false;
    const startGithubDevice = vi.fn(async () => ({
      code: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      expiresAt: IN_15_MIN(),
    }));
    const disconnectGithub = vi.fn(async () => {
      connected = false;
      return githubAuth({ source: "app", connected: false, login: null, scopes: [] });
    });
    const { ws } = renderApp({
      api: api({
        getGithubAuth: async () =>
          connected
            ? githubAuth({ source: "app", connected: true, login: "ana-exemplo" })
            : githubAuth({ source: "app", connected: false, login: null, scopes: [] }),
        startGithubDevice,
        disconnectGithub,
      }),
      initialUrl: "/ingestao",
    });
    await userEvent.click(await screen.findByRole("button", { name: "Conectar GitHub" }));
    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument();
    connected = true;
    ws.emit({
      type: "github.auth_updated",
      status: githubAuth({ source: "app", connected: true, login: "ana-exemplo" }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Desconectar" }));
    expect(await screen.findByRole("button", { name: "Conectar GitHub" })).toBeInTheDocument();
    expect(screen.queryByText("ABCD-1234")).toBeNull();
  });

  it("código expirado oferece gerar outro", async () => {
    const startGithubDevice = vi
      .fn()
      .mockResolvedValueOnce({
        code: "OLD0-0000",
        verificationUri: "https://github.com/login/device",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      })
      .mockResolvedValueOnce({
        code: "NEW1-1111",
        verificationUri: "https://github.com/login/device",
        expiresAt: IN_15_MIN(),
      });
    renderApp({
      api: api({
        getGithubAuth: async () =>
          githubAuth({ source: "app", connected: false, login: null, scopes: [] }),
        startGithubDevice,
      }),
      initialUrl: "/ingestao",
    });
    await userEvent.click(await screen.findByRole("button", { name: "Conectar GitHub" }));
    expect(await screen.findByText("O código expirou.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Gerar outro código" }));
    expect(await screen.findByText("NEW1-1111")).toBeInTheDocument();
  });
});

describe("F03/M4 · GitHub › modo e seleção", () => {
  it("análise privada: grupos, pré-seleção, fork destacado, organização recolhida, contador e marcar todos", async () => {
    const previewGithub = vi.fn(async () => preview());
    renderApp({ api: api({ previewGithub }), initialUrl: "/ingestao" });
    await userEvent.click(await screen.findByRole("radio", { name: "Análise privada" }));
    await userEvent.click(screen.getByRole("button", { name: "Listar repositórios" }));
    expect(previewGithub).toHaveBeenCalledWith({ mode: "private" });
    const personal = await screen.findByRole("group", { name: "Pessoais" });
    expect(within(personal).getByText("2 de 3")).toBeInTheDocument();
    expect(
      within(personal).getByRole("checkbox", { name: "ana-exemplo/api-pagamentos" }),
    ).toBeChecked();
    const fork = within(personal).getByRole("checkbox", { name: "ana-exemplo/fork-lib" });
    expect(fork).not.toBeChecked();
    expect(fork.closest("li")).toHaveAttribute("data-variant", "special");
    expect(within(fork.closest("li") as HTMLElement).getByText("fork")).toBeInTheDocument();
    expect(within(personal).getByText("privado")).toBeInTheDocument();
    expect(
      within(personal).getByRole("link", { name: "Abrir ana-exemplo/api-pagamentos no GitHub" }),
    ).toHaveAttribute("href", "https://github.com/ana-exemplo/api-pagamentos");
    const org = screen.getByRole("button", { name: /acme-labs/ });
    expect(org).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("checkbox", { name: "acme-labs/plataforma" })).toBeNull();
    await userEvent.click(org);
    expect(screen.getByRole("checkbox", { name: "acme-labs/plataforma" })).toBeChecked();
    await userEvent.click(within(personal).getByRole("button", { name: "Marcar todos" }));
    expect(fork).toBeChecked();
    expect(within(personal).getByText("3 de 3")).toBeInTheDocument();
    expect(screen.getByText("4 repositórios selecionados")).toBeInTheDocument();
  });

  it("aviso acima de 10 selecionados, sem bloquear", async () => {
    const many = Array.from({ length: 11 }, (_, i) => previewItem(`repo-${i}`));
    renderApp({
      api: api({
        previewGithub: async () =>
          preview({
            groups: [
              {
                key: "personal",
                kind: "personal",
                label: "ana-exemplo",
                total: 11,
                selected: 11,
                repos: many,
              },
            ],
          }),
      }),
      initialUrl: "/ingestao",
    });
    await userEvent.click(await screen.findByRole("radio", { name: "Análise privada" }));
    await userEvent.click(screen.getByRole("button", { name: "Listar repositórios" }));
    expect(
      await screen.findByText(/Você selecionou 11 repositórios\. Acima de 10/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar análise" })).toBeEnabled();
  });

  it("análise pública pede o login e mostra só a lista", async () => {
    const previewGithub = vi.fn(async () => preview({ mode: "public", authenticated: false }));
    renderApp({
      api: api({
        getGithubAuth: async () =>
          githubAuth({ connected: false, login: null, scopes: [], hostAvailable: false }),
        previewGithub,
      }),
      initialUrl: "/ingestao",
    });
    await userEvent.click(await screen.findByRole("radio", { name: "Análise pública" }));
    await userEvent.type(screen.getByLabelText("Usuário do GitHub"), "ana-exemplo");
    await userEvent.click(screen.getByRole("button", { name: "Listar repositórios" }));
    expect(previewGithub).toHaveBeenCalledWith({ mode: "public", login: "ana-exemplo" });
    expect(await screen.findByRole("group", { name: "Pessoais" })).toBeInTheDocument();
  });

  it("análise privada sem conexão explica que precisa conectar", async () => {
    renderApp({
      api: api({
        getGithubAuth: async () =>
          githubAuth({ source: "app", connected: false, login: null, scopes: [] }),
      }),
      initialUrl: "/ingestao",
    });
    await userEvent.click(await screen.findByRole("radio", { name: "Análise privada" }));
    expect(screen.getByText("Conecte o GitHub para a análise privada.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Listar repositórios" })).toBeDisabled();
  });
});

describe("F03/M4 · GitHub › plano, orçamento, estimativa e início", () => {
  it("mostra o plano e a estimativa e inicia com o orçamento recomendado", async () => {
    const createGithubIngestion = vi.fn(async () =>
      runSummary({ status: "awaiting_confirmation" }),
    );
    const estimateIngestion = vi.fn(async () => estimate());
    const { router } = renderApp({
      api: api({ createGithubIngestion, estimateIngestion }),
      initialUrl: "/ingestao",
    });
    await userEvent.click(await screen.findByRole("radio", { name: "Análise privada" }));
    await userEvent.click(screen.getByRole("button", { name: "Listar repositórios" }));
    await screen.findByRole("group", { name: "Pessoais" });
    const plan = await screen.findByRole("region", { name: "Seu plano" });
    expect(within(plan).getByText("Plano: max")).toBeInTheDocument();
    expect(within(plan).getByText(/Janela de 5 horas: 35% usado/)).toBeInTheDocument();
    expect(within(plan).getByText(/renova em 09\/10\/2026 12:00/)).toBeInTheDocument();
    expect(within(plan).getByText(/Janela semanal: 12% usado/)).toBeInTheDocument();
    const est = await screen.findByRole("region", { name: "Estimativa" });
    await waitFor(() => expect(within(est).getByText("~15.1k tokens")).toBeInTheDocument());
    expect(within(est).getByText("Recomendado: 15k tokens")).toBeInTheDocument();
    expect(within(est).getByText("Fatia por repositório: 3.3k tokens")).toBeInTheDocument();
    expect(within(est).getByText(/ainda é aproximada/)).toBeInTheDocument();
    expect(screen.getByLabelText("Orçamento")).toHaveValue(15);
    expect(screen.getByLabelText("Unidade")).toHaveValue("thousand");
    expect(estimateIngestion).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: "github",
        mode: "private",
        depth: "balanced",
        model: "haiku",
        repos: ["ana-exemplo/api-pagamentos", "ana-exemplo/dotfiles", "acme-labs/plataforma"],
      }),
    );
    await userEvent.selectOptions(screen.getByLabelText("Modelo"), "sonnet");
    await userEvent.clear(screen.getByLabelText("Orçamento"));
    await userEvent.type(screen.getByLabelText("Orçamento"), "20");
    await userEvent.click(screen.getByRole("button", { name: "Iniciar análise" }));
    expect(createGithubIngestion).toHaveBeenCalledWith({
      source: "github",
      mode: "private",
      repos: ["ana-exemplo/api-pagamentos", "ana-exemplo/dotfiles", "acme-labs/plataforma"],
      depth: "balanced",
      model: "sonnet",
      budget: { amount: 20_000, unit: "thousand" },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/ingestao/r1"));
  });

  it("unidade em milhão converte para tokens", async () => {
    const createGithubIngestion = vi.fn(async () => runSummary());
    renderApp({ api: api({ createGithubIngestion }), initialUrl: "/ingestao" });
    await userEvent.click(await screen.findByRole("radio", { name: "Análise privada" }));
    await userEvent.click(screen.getByRole("button", { name: "Listar repositórios" }));
    await screen.findByRole("group", { name: "Pessoais" });
    await screen.findByText("~15.1k tokens");
    await userEvent.selectOptions(screen.getByLabelText("Unidade"), "million");
    await userEvent.clear(screen.getByLabelText("Orçamento"));
    await userEvent.type(screen.getByLabelText("Orçamento"), "1.5");
    await userEvent.click(screen.getByRole("button", { name: "Iniciar análise" }));
    expect(createGithubIngestion).toHaveBeenCalledWith(
      expect.objectContaining({ budget: { amount: 1_500_000, unit: "million" } }),
    );
  });

  it("sem dados do plano, avisa", async () => {
    renderApp({
      api: api({ getPlanUsage: async () => ({ usage: null }) }),
      initialUrl: "/ingestao",
    });
    await userEvent.click(await screen.findByRole("radio", { name: "Análise privada" }));
    await userEvent.click(screen.getByRole("button", { name: "Listar repositórios" }));
    await screen.findByRole("group", { name: "Pessoais" });
    expect(await screen.findByText(/Sem dados do plano/)).toBeInTheDocument();
  });
});

describe("F03/M4 · execuções pendentes na página de ingestão", () => {
  it("lista execuções que esperam você, com estado e link", async () => {
    const listIngestions = vi.fn(async () => ({
      runs: [runSummary(), runSummary({ id: "r2", status: "review", source: "cv" })],
    }));
    renderApp({ api: api({ listIngestions }), initialUrl: "/ingestao" });
    const list = await screen.findByRole("list", { name: "Execuções em andamento e pendentes" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).getByText("Aguardando sua decisão")).toBeInTheDocument();
    expect(within(items[0] as HTMLElement).getByRole("link", { name: "Abrir" })).toHaveAttribute(
      "href",
      "/ingestao/r1",
    );
    expect(within(items[1] as HTMLElement).getByText("Pronta para revisão")).toBeInTheDocument();
  });
});

describe("Regressão 2026-10-10 · erro ao conectar o GitHub aparece na tela", () => {
  it("falha ao iniciar o fluxo (gh ausente no container) mostra a mensagem e o que fazer", async () => {
    const { ApiError } = await import("../../src/lib/api");
    const startGithubDevice = vi.fn(async () => {
      throw new ApiError(503, "github_unavailable", "GitHub CLI indisponível: spawn gh ENOENT");
    });
    renderApp({
      api: api({
        getGithubAuth: async () =>
          githubAuth({ source: "app", connected: false, login: null, scopes: [] }),
        startGithubDevice,
      }),
      initialUrl: "/ingestao",
    });
    await userEvent.click(await screen.findByRole("button", { name: "Conectar GitHub" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Não consegui iniciar o login do GitHub");
    expect(alert).toHaveTextContent("GitHub CLI indisponível");
    expect(alert).toHaveTextContent("make dev-down && make dev");
  });
});
