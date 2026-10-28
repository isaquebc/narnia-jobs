import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { shellApi } from "../f03/shell-api";
import { posting } from "../f06/fixtures";
import { renderApp } from "../router-helpers";

/**
 * F07/M4 · "Aplicar" na extensão (§0-1): na janela da análise (vaga salva) e na do formulário (com a vaga ligada), o
 * mesmo diálogo da página da vaga; formulário sem vaga ligada não aplica.
 */
const reading = {
  ok: true,
  title: "Backend Sr",
  company: "Acme",
  siteName: null,
  location: null,
  description: "Descrição.",
  chars: 900,
  message: null,
};
const capture = (over: Record<string, unknown>) => ({
  id: "c1",
  url: "https://vagas.example/123",
  title: "Vagas",
  createdAt: "2026-10-23T12:00:00.000Z",
  postingId: "v1",
  duplicate: null,
  applicationId: null,
  applicationUrl: null,
  mode: "auto",
  analysis: { requested: false, sessionId: null, error: null },
  reading,
  ...over,
});
const option = {
  documentId: "d1",
  versionId: "dv1",
  version: 1,
  scope: "posting",
  profileId: "p1",
  createdAt: "2026-10-20T12:00:00.000Z",
};
const application = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  captureId: "c1",
  url: "https://acme.example/aplicar",
  title: "Candidatura",
  status: "ready",
  error: null,
  warning: null,
  postingId: "v1",
  posting: { title: "Backend Sr", company: "Acme" },
  profileId: "p1",
  createdAt: "2026-10-23T12:00:00.000Z",
  updatedAt: "2026-10-23T12:00:00.000Z",
  questions: [],
  ...over,
});

function api(over: Record<string, unknown>) {
  return {
    ...shellApi,
    getPosting: async () => ({ posting: posting("v1"), contacts: [], notes: [], duplicates: [] }),
    listPostingAnalyses: async () => ({ analyses: [] }),
    listDocuments: async () => ({ documents: [] }),
    getApplyOptions: vi.fn(async () => ({
      cvs: [option],
      coverLetters: [],
      activeApplicationId: null,
    })),
    createJobApplication: vi.fn(async () => ({ application: { id: "ja1" } })),
    ...over,
  };
}

describe("F07/M4 · Aplicar na extensão", () => {
  it("janela da análise: aplica na vaga salva", async () => {
    const a = api({ getExtensionCapture: async () => ({ capture: capture({}) }) });
    renderApp({ api: a as never, initialUrl: "/candidatura?captura=c1" });
    await userEvent.click(await screen.findByRole("button", { name: "Aplicar" }));
    const dialog = await screen.findByRole("dialog", { name: "Aplicar nesta vaga" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirmar candidatura" }));
    await waitFor(() =>
      expect(a.createJobApplication).toHaveBeenCalledWith(
        expect.objectContaining({ postingId: "v1", cvVersionId: "dv1" }),
      ),
    );
  });

  it("janela do formulário: com a vaga ligada aplica; sem vaga, não há o botão", async () => {
    const a = api({
      getExtensionCapture: async () => ({
        capture: capture({ postingId: null, applicationId: "a1", mode: "form" }),
      }),
      getApplication: async () => ({ application: application() }),
    });
    const { unmount } = renderApp({ api: a as never, initialUrl: "/candidatura?captura=c1" });
    expect(await screen.findByRole("button", { name: "Aplicar" })).toBeInTheDocument();
    unmount();
    renderApp({
      api: api({
        getExtensionCapture: async () => ({
          capture: capture({ postingId: null, applicationId: "a1", mode: "form" }),
        }),
        getApplication: async () => ({
          application: application({ postingId: null, posting: null }),
        }),
        listPostings: async () => ({ postings: [] }),
      }) as never,
      initialUrl: "/candidatura?captura=c1",
    });
    expect(
      await screen.findByRole("heading", { name: /Candidatura|Formulário/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aplicar" })).toBeNull();
  });
});
