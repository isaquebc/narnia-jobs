import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SemanticSearchView } from "../../src/lib/api";
import { githubAuth, ingestSettings } from "../f03/fixtures";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";

/**
 * R6 (FF-5, FF-7): Configurações › Busca por sentido. Opcional; o aviso aparece quando o índice dos fatos no contexto do
 * recrutador corta fatos, e a pessoa pode ligar antes.
 */
const view = (p: Partial<SemanticSearchView> = {}): SemanticSearchView => ({
  enabled: false,
  status: "off",
  progress: null,
  error: null,
  model: "Xenova/multilingual-e5-small",
  cutFacts: 0,
  alert: false,
  vectors: 0,
  ...p,
});

const base = {
  ...shellApi,
  listNotifications: async () => ({ notifications: [], unresolved: 0 }),
  getIngestSettings: async () => ingestSettings(),
  getGithubAuth: async () => githubAuth(),
  listSnapshots: async () => ({ snapshots: [], totalBytes: 0, maxBytes: 2 * 1024 ** 3 }),
  getBackupSettings: async () => ({ max: 5, enabled: false, latest: null, count: 0 }),
};

describe("Configurações › Busca por sentido", () => {
  it("desligada sem aviso: dá para ligar antes do limite", async () => {
    const api = {
      ...base,
      getSemanticSearch: vi.fn(async () => view()),
      putSemanticSearch: vi.fn(async () =>
        view({ enabled: true, status: "loading", progress: 0.4 }),
      ),
    };
    renderApp({ api: api as never, initialUrl: "/configuracoes" });
    const section = await screen.findByRole("region", { name: "Busca por sentido" });
    const enable = await within(section).findByRole("button", { name: "Ligar busca por sentido" });
    expect(within(section).queryByRole("alert")).toBeNull();
    await userEvent.click(enable);
    await waitFor(() => expect(api.putSemanticSearch).toHaveBeenCalledWith({ enabled: true }));
    expect(await within(section).findByText(/Baixando o modelo: 40%/)).toBeInTheDocument();
  });

  it("com fatos cortados, mostra o aviso", async () => {
    const api = {
      ...base,
      getSemanticSearch: vi.fn(async () => view({ cutFacts: 12, alert: true })),
      putSemanticSearch: vi.fn(async () => view()),
    };
    renderApp({ api: api as never, initialUrl: "/configuracoes" });
    const section = await screen.findByRole("region", { name: "Busca por sentido" });
    expect(await within(section).findByRole("alert")).toHaveTextContent(/12 fatos/);
  });

  it("pronta: mostra os fatos vetorizados e desliga", async () => {
    const api = {
      ...base,
      getSemanticSearch: vi.fn(async () => view({ enabled: true, status: "ready", vectors: 39 })),
      putSemanticSearch: vi.fn(async () => view()),
    };
    renderApp({ api: api as never, initialUrl: "/configuracoes" });
    const section = await screen.findByRole("region", { name: "Busca por sentido" });
    expect(await within(section).findByText(/Ligada: 39 fatos/)).toBeInTheDocument();
    await userEvent.click(
      within(section).getByRole("button", { name: "Desligar busca por sentido" }),
    );
    await waitFor(() => expect(api.putSemanticSearch).toHaveBeenCalledWith({ enabled: false }));
  });
});
