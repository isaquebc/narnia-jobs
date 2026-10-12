import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BudgetInput, toTokens } from "../../src/features/ingestion/BudgetInput";
import { renderApp } from "../router-helpers";
import { estimate, notification } from "./fixtures";
import { shellApi } from "./shell-api";

/** Plano de correções F03, lote L2 (itens 7, 8 e 9 na web). */

describe("F03 fix L2 · item 7: sino sem as concluídas", () => {
  it("só 'ingestão concluída' aberta → sino sem contador", async () => {
    renderApp({
      api: {
        ...shellApi,
        listNotifications: async () => ({
          notifications: [
            notification({ kind: "ingestion.done", title: "Ingestão concluída: cv.pdf" }),
          ],
          unresolved: 0,
        }),
      },
      initialUrl: "/dashboard",
    });
    const bell = await screen.findByRole("link", { name: "Notificações" });
    expect(within(bell).queryByTestId("notifications-count")).toBeNull();
  });
});

describe("F03 fix L2 · item 8: unidade % da janela (FX-4)", () => {
  it("com conversão aprendida, % vira tokens pela conversão do modelo", () => {
    expect(toTokens(30, "window_pct", 14_000)).toBe(420_000);
    expect(toTokens(2, "million", null)).toBe(2_000_000);
  });

  it("sem conversão, a opção % fica desabilitada com a dica", () => {
    render(
      <BudgetInput
        value="50"
        unit="thousand"
        model="sonnet"
        pctToTokens={null}
        onValueChange={() => {}}
        onUnitChange={() => {}}
      />,
    );
    const pct = screen.getByRole("option", { name: "% da janela" }) as HTMLOptionElement;
    expect(pct.disabled).toBe(true);
    expect(
      screen.getByText("% da janela: disponível depois da primeira execução com este modelo."),
    ).toBeInTheDocument();
  });

  it("com conversão e % escolhido, mostra o equivalente em tokens", () => {
    render(
      <BudgetInput
        value="30"
        unit="window_pct"
        model="sonnet"
        pctToTokens={14_000}
        onValueChange={() => {}}
        onUnitChange={() => {}}
      />,
    );
    expect(
      (screen.getByRole("option", { name: "% da janela" }) as HTMLOptionElement).disabled,
    ).toBe(false);
    expect(screen.getByText("30% ≈ 420 mil tokens em sonnet")).toBeInTheDocument();
  });
});

const loggedIn = {
  installed: true,
  loggedIn: true,
  authMethod: "claude.ai",
  version: "2",
  loginHint: null,
};
const uploaded = (previousRuns: unknown[] = []) => ({
  id: "f1",
  kind: "cv" as const,
  originalName: "cv.pdf",
  mime: "application/pdf",
  size: 2048,
  pages: 2,
  uploadedAt: "2026-10-09T12:00:00.000Z",
  previousRuns,
});
function wizardApi(overrides: Record<string, unknown>): never {
  return {
    getOnboardingState: async () => ({ step: 2, completed: false }),
    putOnboardingState: async (s: unknown) => s,
    getProviderStatus: async () => loggedIn,
    listJobs: async () => ({ jobs: [] }),
    listProfiles: async () => ({ profiles: [] }),
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    getEstimate: async () => ({ calls: [], totalTokens: 7000 }),
    getIngestion: async () => ({ id: "r1", status: "running", jobs: [], proposals: [] }),
    ...overrides,
  } as never;
}

describe("F03 fix L2 · item 9: onboarding com autoconfirmação e 'já lido'", () => {
  it("estimativa abaixo do limiar: segue sozinho para a extração", async () => {
    const createIngestion = vi.fn(async () => ({ id: "r1", status: "queued" }));
    renderApp({
      api: wizardApi({
        uploadFile: async () => uploaded(),
        estimateIngestion: async () => estimate({ autoConfirm: true, totalTokens: 7000 }),
        createIngestion,
      }),
      initialUrl: "/",
    });
    await screen.findByText("Passo 2 de 6");
    await userEvent.upload(
      screen.getByLabelText(/escolher arquivo/i),
      new File(["%PDF"], "cv.pdf", { type: "application/pdf" }),
    );
    await waitFor(() => expect(createIngestion).toHaveBeenCalledTimes(1));
  });

  it("acima do limiar: espera o clique em Extrair", async () => {
    const createIngestion = vi.fn(async () => ({ id: "r1", status: "queued" }));
    renderApp({
      api: wizardApi({
        uploadFile: async () => uploaded(),
        estimateIngestion: async () => estimate({ autoConfirm: false, totalTokens: 18000 }),
        createIngestion,
      }),
      initialUrl: "/",
    });
    await screen.findByText("Passo 2 de 6");
    await userEvent.upload(
      screen.getByLabelText(/escolher arquivo/i),
      new File(["%PDF"], "cv.pdf", { type: "application/pdf" }),
    );
    const extract = await screen.findByRole("button", { name: "Extrair" });
    await waitFor(() => expect(extract).toBeEnabled());
    expect(createIngestion).not.toHaveBeenCalled();
    await userEvent.click(extract);
    await waitFor(() => expect(createIngestion).toHaveBeenCalledTimes(1));
  });

  it("arquivo já lido: mostra o aviso com link e não segue sozinho", async () => {
    const createIngestion = vi.fn(async () => ({ id: "r1", status: "queued" }));
    renderApp({
      api: wizardApi({
        uploadFile: async () =>
          uploaded([{ runId: "r0", status: "done", createdAt: "2026-10-08T12:00:00.000Z" }]),
        estimateIngestion: async () => estimate({ autoConfirm: true, totalTokens: 7000 }),
        createIngestion,
      }),
      initialUrl: "/",
    });
    await screen.findByText("Passo 2 de 6");
    await userEvent.upload(
      screen.getByLabelText(/escolher arquivo/i),
      new File(["%PDF"], "cv.pdf", { type: "application/pdf" }),
    );
    expect(await screen.findByRole("link", { name: "Abrir execução anterior" })).toHaveAttribute(
      "href",
      "/ingestao/r0",
    );
    expect(createIngestion).not.toHaveBeenCalled();
  });
});
