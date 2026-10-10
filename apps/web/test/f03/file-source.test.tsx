import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "../router-helpers";
import { estimate, githubAuth, ingestSettings, planUsage, run } from "./fixtures";
import { shellApi } from "./shell-api";

const uploaded = (previousRuns: unknown[] = []) => ({
  id: "f1",
  kind: "cv" as const,
  originalName: "cv-2.pdf",
  mime: "application/pdf",
  size: 2048,
  pages: 2,
  uploadedAt: "2026-10-09T12:00:00.000Z",
  previousRuns,
});

function api(overrides: Record<string, unknown> = {}) {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    listIngestions: async () => ({ runs: [] }),
    getGithubAuth: async () => githubAuth(),
    getIngestSettings: async () => ingestSettings(),
    getPlanUsage: async () => planUsage(),
    getIngestion: async () => run({ id: "r9", source: "cv" }),
    ...overrides,
  };
}

describe("F03/M4 · CV e texto adicionais", () => {
  it("arquivo já lido: avisa com link para a execução anterior e só segue com 'Ler de novo'", async () => {
    const uploadFile = vi.fn(async () =>
      uploaded([{ runId: "r0", status: "done", createdAt: "2026-10-08T12:00:00.000Z" }]),
    );
    const estimateIngestion = vi.fn(async () =>
      estimate({ autoConfirm: true, totalTokens: 6_000, perRepo: null, approximate: false }),
    );
    const createIngestion = vi.fn(async () => run({ id: "r9", source: "cv" }));
    const { router } = renderApp({
      api: api({ uploadFile, estimateIngestion, createIngestion }),
      initialUrl: "/ingestao",
    });
    await userEvent.click(await screen.findByRole("tab", { name: "Currículo" }));
    const file = new File(["%PDF-1.4"], "cv-2.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText(/escolher arquivo/i), file);
    expect(
      await screen.findByText("Este conteúdo já foi lido em 08/10/2026 09:00."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir execução anterior" })).toHaveAttribute(
      "href",
      "/ingestao/r0",
    );
    expect(estimateIngestion).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Ler de novo" }));
    await waitFor(() =>
      expect(estimateIngestion).toHaveBeenCalledWith({ source: "cv", fileId: "f1" }),
    );
    await waitFor(() => expect(createIngestion).toHaveBeenCalledWith({ fileId: "f1" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/ingestao/r9"));
  });

  it("acima do limiar de autoconfirmação mostra a estimativa e espera 'Extrair'", async () => {
    const createText = vi.fn(async () => ({ ...uploaded(), id: "t1", kind: "text" as const }));
    const estimateIngestion = vi.fn(async () =>
      estimate({ autoConfirm: false, totalTokens: 12_400, perRepo: null, approximate: false }),
    );
    const createIngestion = vi.fn(async () => run({ id: "r9", source: "text" }));
    renderApp({
      api: api({ createText, estimateIngestion, createIngestion }),
      initialUrl: "/ingestao",
    });
    await userEvent.click(await screen.findByRole("tab", { name: "Texto livre" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Conte a sua história de carreira e de vida" }),
      "a".repeat(220),
    );
    await userEvent.click(screen.getByRole("button", { name: "Calcular estimativa" }));
    expect(createText).toHaveBeenCalledWith("a".repeat(220));
    expect(await screen.findByText("~12.4k tokens")).toBeInTheDocument();
    expect(createIngestion).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Extrair" }));
    await waitFor(() => expect(createIngestion).toHaveBeenCalledWith({ fileId: "t1" }));
  });
});
