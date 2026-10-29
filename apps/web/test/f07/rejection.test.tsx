import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";

/**
 * Desclassificação (pedido do dono, 2026-10-29): "Fui desclassificado(a)" na candidatura abre o campo para colar o
 * e-mail, a etapa (a atual por padrão; ou sem etapa) e a data; a candidatura encerrada mostra a etapa e o funil conta
 * por etapa.
 */
const stages = [
  { id: "s1", name: "Triagem", position: 1 },
  { id: "s2", name: "Case técnico", position: 2 },
];
const base = {
  id: "a1",
  postingId: "v1",
  profileId: "p1",
  cv: { documentId: "d1", versionId: "dv2", version: 2, scope: "posting" },
  coverLetter: null,
  appliedOn: "2026-10-20",
  column: "in_process",
  closedReason: null,
  closedStage: null,
  closedEntryId: null,
  stages,
  currentStageId: "s2",
  lastActivityAt: "2026-10-20T12:00:00.000Z",
  archivedAt: null,
  createdAt: "2026-10-20T12:00:00.000Z",
  updatedAt: "2026-10-20T12:00:00.000Z",
  posting: { company: "Acme", client: null, title: "Backend Sr", role: "backend" },
  contacts: [],
  progress: { current: 2, total: 2 },
};

function api(application: Record<string, unknown> = base) {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    listIngestions: async () => ({ runs: [] }),
    listChatSessions: async () => ({ sessions: [] }),
    listPendingNotes: async () => ({ notes: [] }),
    getJobApplication: async () => ({ application }),
    documentPdfUrl: () => "/x.pdf",
    putJobApplicationStages: vi.fn(),
    listJobApplicationEntries: async () => ({ entries: [] }),
    rejectJobApplication: vi.fn(async () => ({
      application: {
        ...base,
        column: "closed",
        closedReason: "rejected",
        closedStage: "Case técnico",
      },
    })),
  };
}

describe("desclassificação na candidatura", () => {
  it("cola o e-mail, a etapa atual vem marcada e dá para escolher sem etapa", async () => {
    const a = api();
    renderApp({ api: a as never, initialUrl: "/candidaturas/a1" });
    await userEvent.click(await screen.findByRole("button", { name: "Fui desclassificado(a)" }));
    const dialog = await screen.findByRole("dialog", { name: "Desclassificação" });
    const stage = within(dialog).getByRole("combobox", { name: "Etapa" });
    expect(stage).toHaveValue("s2");
    await userEvent.selectOptions(stage, "");
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: /E-mail ou motivo/ }),
      "O processo seletivo foi finalizado.",
    );
    const date = within(dialog).getByLabelText("Data");
    await userEvent.clear(date);
    await userEvent.type(date, "2026-10-27");
    await userEvent.click(within(dialog).getByRole("button", { name: "Encerrar candidatura" }));
    await waitFor(() =>
      expect(a.rejectJobApplication).toHaveBeenCalledWith("a1", {
        occurredOn: "2026-10-27",
        message: "O processo seletivo foi finalizado.",
        stageId: null,
      }),
    );
  });

  it("sem texto não encerra", async () => {
    const a = api();
    renderApp({ api: a as never, initialUrl: "/candidaturas/a1" });
    await userEvent.click(await screen.findByRole("button", { name: "Fui desclassificado(a)" }));
    const dialog = await screen.findByRole("dialog", { name: "Desclassificação" });
    expect(within(dialog).getByRole("button", { name: "Encerrar candidatura" })).toBeDisabled();
  });

  it("encerrada: mostra a etapa da desclassificação e some o botão", async () => {
    renderApp({
      api: api({
        ...base,
        column: "closed",
        closedReason: "rejected",
        closedStage: "Case técnico",
        closedEntryId: "e1",
      }) as never,
      initialUrl: "/candidaturas/a1",
    });
    expect(await screen.findByText("Não aprovado na etapa Case técnico")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fui desclassificado(a)" })).toBeNull();
  });
});
