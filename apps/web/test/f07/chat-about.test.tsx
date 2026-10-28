import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";

/** F07/M6 · conversar com o recrutador sobre a candidatura: a mensagem abre (ou continua) a conversa dela. */
const app = {
  id: "a1",
  postingId: "v1",
  profileId: "p1",
  cv: { documentId: "d1", versionId: "dv2", version: 2, scope: "posting" },
  coverLetter: null,
  appliedOn: "2026-10-20",
  column: "applied",
  closedReason: null,
  stages: [],
  currentStageId: null,
  lastActivityAt: "2026-10-20T12:00:00.000Z",
  archivedAt: null,
  createdAt: "2026-10-20T12:00:00.000Z",
  updatedAt: "2026-10-20T12:00:00.000Z",
  posting: { company: "Acme", client: null, title: "Backend Sr", role: "backend" },
  contacts: [],
  progress: { current: 0, total: 0 },
};

describe("F07/M6 · conversar sobre a candidatura", () => {
  it("manda a mensagem e abre a conversa", async () => {
    const openJobApplicationChat = vi.fn(async () => ({ session: { id: "s9" } }));
    const { router } = renderApp({
      api: {
        ...shellApi,
        listNotifications: async () => ({ notifications: [], unresolved: 0 }),
        listChatSessions: async () => ({ sessions: [] }),
        getJobApplication: async () => ({ application: app }),
        documentPdfUrl: () => "/x.pdf",
        listJobApplicationEntries: async () => ({ entries: [] }),
        listJobApplicationEvents: async () => ({ events: [] }),
        getPosting: async () => ({
          posting: { id: "v1" },
          contacts: [],
          notes: [],
          duplicates: [],
        }),
        openJobApplicationChat,
      } as never,
      initialUrl: "/candidaturas/a1",
    });
    const box = await screen.findByRole("textbox", { name: "Mensagem para o recrutador" });
    await userEvent.type(box, "Me ajuda a preparar a entrevista técnica?");
    await userEvent.click(screen.getByRole("button", { name: "Conversar sobre esta candidatura" }));
    await waitFor(() =>
      expect(openJobApplicationChat).toHaveBeenCalledWith(
        "a1",
        "Me ajuda a preparar a entrevista técnica?",
      ),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/chat/s9"));
  });
});
