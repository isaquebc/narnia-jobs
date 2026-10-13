import type { EvalsSettingsResponse } from "@narnia-jobs/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { githubAuth, ingestSettings } from "../f03/fixtures";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";

/** Avaliações no Phoenix (M1, decisão AV-2): Configurações › Avaliações (ponte da assinatura e Phoenix). */
const view = (
  over: {
    bridge?: Record<string, unknown>;
    phoenix?: Record<string, unknown>;
    prompts?: Partial<EvalsSettingsResponse["prompts"]>;
  } = {},
): EvalsSettingsResponse => ({
  bridge: {
    settings: { enabled: true, defaultModel: "sonnet", concurrency: 2 },
    key: "narnia-ponte-abc123",
    url: "http://api:3100/bridge/anthropic",
    ...over.bridge,
  },
  phoenix: {
    url: "http://phoenix:6006",
    reachable: true,
    providerName: "narnia-assinatura",
    providerRegistered: false,
    anthropicKeySet: false,
    ...over.phoenix,
  },
  prompts: { count: 17, lastSync: null, ...over.prompts },
});

function api(overrides: Record<string, unknown> = {}) {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    getIngestSettings: async () => ingestSettings(),
    getGithubAuth: async () => githubAuth(),
    listSnapshots: async () => ({ snapshots: [], totalBytes: 0, maxBytes: 2 * 1024 ** 3 }),
    getChatSettings: async () => ({
      settings: {
        maxLiveSessions: 5,
        hibernateAfterMin: 60,
        maxTurns: 8,
        defaultModel: "sonnet",
        maxBudgetUsd: null,
        requireTrustedResearch: true,
      },
    }),
    listTrustedDomains: async () => ({ domains: [] }),
    getPluginStatus: async () => ({
      mcpUrl: "http://127.0.0.1:3100/mcp",
      mcp: { ok: true, tools: 34 },
      command: "./start.sh install-plugin",
      doctorCommand: "./start.sh doctor",
      lastSeenAt: null,
    }),
    getEvalsSettings: vi.fn(async () => view()),
    putBridgeSettings: vi.fn(async (p: Record<string, unknown>) =>
      view({
        bridge: { settings: { enabled: true, defaultModel: "sonnet", concurrency: 2, ...p } },
      }),
    ),
    rotateBridgeKey: vi.fn(async () => view({ bridge: { key: "narnia-ponte-novo999" } })),
    registerPhoenixBridge: vi.fn(async () => view({ phoenix: { providerRegistered: true } })),
    syncPhoenixPrompts: vi.fn(async () =>
      view({
        prompts: {
          lastSync: {
            at: "2026-10-13T12:00:00Z",
            created: 2,
            updated: 1,
            unchanged: 14,
            datasets: 8,
            evaluatorsCreated: 27,
            evaluatorsUpdated: 0,
            error: null,
          },
        },
      }),
    ),
    putPhoenixAnthropicKey: vi.fn(async (k: string | null) =>
      view({ phoenix: { anthropicKeySet: k !== null } }),
    ),
    ...overrides,
  };
}

const section = async () =>
  within(await screen.findByRole("region", { name: "Avaliações (Phoenix)" }));

describe("Configurações › Avaliações", () => {
  it("mostra a ponte ligada, o endereço visto pelo Phoenix e a chave escondida até pedir", async () => {
    renderApp({ api: api(), initialUrl: "/configuracoes" });
    const s = await section();
    expect(await s.findByRole("switch", { name: "Ponte pela assinatura ligada" })).toBeChecked();
    expect(s.getByText("http://api:3100/bridge/anthropic")).toBeInTheDocument();
    expect(s.queryByText("narnia-ponte-abc123")).not.toBeInTheDocument();
    await userEvent.click(s.getByRole("button", { name: "Mostrar chave" }));
    expect(s.getByText("narnia-ponte-abc123")).toBeInTheDocument();
  });

  it("salva liga/desliga, modelo padrão e chamadas simultâneas", async () => {
    const a = api();
    renderApp({ api: a, initialUrl: "/configuracoes" });
    const s = await section();
    await userEvent.click(await s.findByRole("switch", { name: "Ponte pela assinatura ligada" }));
    const conc = s.getByLabelText("Chamadas simultâneas");
    await userEvent.clear(conc);
    await userEvent.type(conc, "3");
    await userEvent.selectOptions(s.getByLabelText("Modelo padrão da ponte"), "haiku");
    await userEvent.click(s.getByRole("button", { name: "Salvar ponte" }));
    await waitFor(() =>
      expect(a.putBridgeSettings).toHaveBeenCalledWith({
        enabled: false,
        defaultModel: "haiku",
        concurrency: 3,
      }),
    );
  });

  it("registra a ponte no Phoenix e troca a chave", async () => {
    const a = api();
    renderApp({ api: a, initialUrl: "/configuracoes" });
    const s = await section();
    expect(await s.findByText(/ainda não está registrada no Phoenix/)).toBeInTheDocument();
    await userEvent.click(s.getByRole("button", { name: "Registrar no Phoenix" }));
    expect(await s.findByText(/registrada no Phoenix como narnia-assinatura/)).toBeInTheDocument();
    await userEvent.click(s.getByRole("button", { name: "Trocar chave" }));
    await waitFor(() => expect(a.rotateBridgeKey).toHaveBeenCalled());
  });

  it("guarda e apaga a chave de API da Anthropic no Phoenix (opcional)", async () => {
    const a = api();
    renderApp({ api: a, initialUrl: "/configuracoes" });
    const s = await section();
    await userEvent.type(
      await s.findByLabelText("Chave de API da Anthropic (opcional)"),
      "sk-ant-1",
    );
    await userEvent.click(s.getByRole("button", { name: "Guardar no Phoenix" }));
    await waitFor(() => expect(a.putPhoenixAnthropicKey).toHaveBeenCalledWith("sk-ant-1"));
    expect(await s.findByText(/Chave de API guardada no Phoenix/)).toBeInTheDocument();
    await userEvent.click(s.getByRole("button", { name: "Apagar chave do Phoenix" }));
    await waitFor(() => expect(a.putPhoenixAnthropicKey).toHaveBeenLastCalledWith(null));
  });

  it("Phoenix fora do ar: aviso acionável e ações do Phoenix desabilitadas", async () => {
    renderApp({
      api: api({ getEvalsSettings: async () => view({ phoenix: { reachable: false } }) }),
      initialUrl: "/configuracoes",
    });
    const s = await section();
    expect(await s.findByText(/O Phoenix não respondeu/)).toBeInTheDocument();
    expect(s.getByRole("button", { name: "Registrar no Phoenix" })).toBeDisabled();
  });

  it("sincroniza os 17 prompts com o Phoenix e mostra o resumo", async () => {
    const a = api();
    renderApp({ api: a, initialUrl: "/configuracoes" });
    const s = await section();
    expect(await s.findByText(/17 prompts do repositório/)).toBeInTheDocument();
    expect(s.getByText(/8 datasets com avaliadores/)).toBeInTheDocument();
    expect(s.getByText(/Ainda não sincronizados/)).toBeInTheDocument();
    await userEvent.click(s.getByRole("button", { name: "Sincronizar prompts e avaliadores" }));
    await waitFor(() => expect(a.syncPhoenixPrompts).toHaveBeenCalled());
    expect(
      await s.findByText(
        /prompts: 2 novos, 1 com versão nova, 14 sem mudança; avaliadores: 27 novos, 0 com versão nova/,
      ),
    ).toBeInTheDocument();
  });
});
