import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "../router-helpers";
import { githubAuth, ingestSettings, runSummary } from "./fixtures";
import { shellApi } from "./shell-api";

/** Plano de correções F03, lote L3 (itens 15 e 16 na web). */
function api(overrides: Record<string, unknown> = {}) {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    getGithubAuth: async () => githubAuth(),
    ...overrides,
  };
}
const snap = (id: string, ref: string, size: number) => ({
  id,
  source: "github",
  ref,
  headSha: null,
  size,
  takenAt: "2026-10-09T12:00:00.000Z",
  lastUsedAt: null,
});

describe("F03 fix L3 · item 15: teto de snapshots em Configurações", () => {
  it("acima do teto: aviso e botão que apaga os mais antigos até caber", async () => {
    const pruneSnapshots = vi.fn(async () => ({ removed: 1, totalBytes: 600, maxBytes: 1_000 }));
    renderApp({
      api: api({
        getIngestSettings: async () => ingestSettings(),
        listSnapshots: async () => ({
          snapshots: [snap("s1", "old/old", 600), snap("s2", "new/new", 600)],
          totalBytes: 1_200,
          maxBytes: 1_000,
        }),
        pruneSnapshots,
      }),
      initialUrl: "/configuracoes",
    });
    const region = await screen.findByRole("region", { name: "Snapshots" });
    expect(
      within(region).getByText("Acima do teto: apague os menos usados para liberar espaço."),
    ).toBeInTheDocument();
    await userEvent.click(
      within(region).getByRole("button", { name: "Apagar os mais antigos até caber" }),
    );
    await waitFor(() => expect(pruneSnapshots).toHaveBeenCalledTimes(1));
  });

  it("abaixo do teto: sem aviso nem botão de poda", async () => {
    renderApp({
      api: api({
        getIngestSettings: async () => ingestSettings(),
        listSnapshots: async () => ({
          snapshots: [snap("s1", "a/a", 100)],
          totalBytes: 100,
          maxBytes: 1_000,
        }),
      }),
      initialUrl: "/configuracoes",
    });
    const region = await screen.findByRole("region", { name: "Snapshots" });
    expect(
      within(region).queryByRole("button", { name: "Apagar os mais antigos até caber" }),
    ).toBeNull();
  });
});

describe("F03 fix L3 · item 16: execuções paradas na bandeja", () => {
  it("execução aguardando decisão aparece na bandeja com link para abrir", async () => {
    renderApp({
      api: api({
        listIngestions: async () => ({
          runs: [runSummary({ id: "r7", status: "awaiting_decision" })],
        }),
      }),
      initialUrl: "/dashboard",
    });
    await userEvent.click(await screen.findByRole("button", { name: "Atividades" }));
    const tray = await screen.findByRole("region", { name: "Atividades" });
    const item = await within(tray).findByRole("listitem", { name: /Aguardando sua decisão/ });
    expect(within(item).getByRole("link", { name: "Abrir" })).toHaveAttribute(
      "href",
      "/ingestao/r7",
    );
  });
});
