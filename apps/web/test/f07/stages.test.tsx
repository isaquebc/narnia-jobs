import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";

/**
 * F07/M2 · pipeline editável na página da candidatura: adicionar, remover, reordenar (arrastar ou botões) e escolher a
 * etapa atual. Cada mudança grava a lista inteira em ordem (`PUT …/stages`).
 */
const stages = ["Triagem", "Case técnico", "Conversa com o CTO"].map((name, i) => ({
  id: `st${i + 1}`,
  name,
  position: i + 1,
}));

const app = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  postingId: "v1",
  profileId: "p1",
  cv: { documentId: "d1", versionId: "dv2", version: 2, scope: "posting" },
  coverLetter: null,
  appliedOn: "2026-10-20",
  column: "in_process",
  closedReason: null,
  stages,
  currentStageId: "st1",
  lastActivityAt: "2026-10-20T12:00:00.000Z",
  archivedAt: null,
  createdAt: "2026-10-20T12:00:00.000Z",
  updatedAt: "2026-10-20T12:00:00.000Z",
  posting: { company: "Acme", client: null, title: "Backend Sr", role: "backend" },
  contacts: [],
  progress: { current: 1, total: 3 },
  ...over,
});

function api() {
  // o servidor guarda a lista que recebeu (a próxima leitura já vem com ela)
  let current = stages;
  const put = vi.fn(async (_id: string, next: Array<{ id?: string; name: string }>) => {
    current = next.map((s, i) => ({ id: s.id ?? `novo${i}`, name: s.name, position: i + 1 }));
    return { application: app({ stages: current }) };
  });
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    listIngestions: async () => ({ runs: [] }),
    listChatSessions: async () => ({ sessions: [] }),
    listPendingNotes: async () => ({ notes: [] }),
    getJobApplication: async () => ({ application: app({ stages: current }) }),
    documentPdfUrl: () => "/x.pdf",
    putJobApplicationStages: put,
    patchJobApplication: vi.fn(async () => ({ application: app() })),
  };
}

const list = () => screen.findByRole("list", { name: "Etapas do processo" });

describe("F07/M2 · etapas da candidatura", () => {
  it("adiciona uma etapa no fim", async () => {
    const a = api();
    renderApp({ api: a as never, initialUrl: "/candidaturas/a1" });
    await list();
    await userEvent.type(screen.getByRole("textbox", { name: "Nova etapa" }), "Pair programming");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar etapa" }));
    await waitFor(() =>
      expect(a.putJobApplicationStages).toHaveBeenCalledWith("a1", [
        { id: "st1", name: "Triagem" },
        { id: "st2", name: "Case técnico" },
        { id: "st3", name: "Conversa com o CTO" },
        { name: "Pair programming" },
      ]),
    );
  });

  it("remove e reordena pelos botões; a etapa atual pelo botão da etapa", async () => {
    const a = api();
    renderApp({ api: a as never, initialUrl: "/candidaturas/a1" });
    const ol = await list();
    expect(within(ol).getAllByRole("listitem")).toHaveLength(3);
    await userEvent.click(within(ol).getByRole("button", { name: "Remover a etapa Case técnico" }));
    await waitFor(() =>
      expect(a.putJobApplicationStages).toHaveBeenLastCalledWith("a1", [
        { id: "st1", name: "Triagem" },
        { id: "st3", name: "Conversa com o CTO" },
      ]),
    );
    await userEvent.click(
      within(ol).getByRole("button", { name: "Subir a etapa Conversa com o CTO" }),
    );
    await waitFor(() =>
      expect(a.putJobApplicationStages).toHaveBeenLastCalledWith("a1", [
        { id: "st3", name: "Conversa com o CTO" },
        { id: "st1", name: "Triagem" },
      ]),
    );
    await userEvent.click(
      within(ol).getByRole("button", { name: "Marcar Conversa com o CTO como a etapa atual" }),
    );
    await waitFor(() =>
      expect(a.patchJobApplication).toHaveBeenCalledWith("a1", { currentStageId: "st3" }),
    );
    expect(
      within(ol).getByRole("button", { name: "Arrastar a etapa Triagem" }),
    ).toBeInTheDocument();
  });
});
