import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";

/**
 * F07/M3 · notas e anexos na página da candidatura: texto e/ou arquivos com a data escolhida (hoje por padrão, até
 * hoje); imagem e vídeo com prévia, PDF abre, o resto baixa; editar e apagar.
 */
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

const att = (id: string, fileName: string, mime: string) => ({
  id,
  fileName,
  mime,
  size: 2048,
  createdAt: "2026-10-22T12:00:00.000Z",
});

const entries = [
  {
    id: "e2",
    applicationId: "a1",
    occurredOn: "2026-10-24",
    body: "Convite para o case",
    attachments: [
      att("t1", "convite.png", "image/png"),
      att("t2", "entrevista.mp4", "video/mp4"),
      att("t3", "case.pdf", "application/pdf"),
      att("t4", "planilha.xlsx", "application/vnd.ms-excel"),
    ],
    createdAt: "2026-10-24T12:00:00.000Z",
    updatedAt: "2026-10-24T12:00:00.000Z",
  },
  {
    id: "e1",
    applicationId: "a1",
    occurredOn: "2026-10-22",
    body: "E-mail da recrutadora",
    attachments: [],
    createdAt: "2026-10-22T12:00:00.000Z",
    updatedAt: "2026-10-22T12:00:00.000Z",
  },
];

function api() {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    listIngestions: async () => ({ runs: [] }),
    listChatSessions: async () => ({ sessions: [] }),
    listPendingNotes: async () => ({ notes: [] }),
    getJobApplication: async () => ({ application: app }),
    documentPdfUrl: () => "/x.pdf",
    putJobApplicationStages: vi.fn(),
    listJobApplicationEntries: vi.fn(async () => ({ entries })),
    createJobApplicationEntry: vi.fn(async () => ({ entry: entries[1] })),
    patchJobApplicationEntry: vi.fn(async () => ({ entry: entries[1] })),
    deleteJobApplicationEntry: vi.fn(async () => null),
    jobApplicationAttachmentUrl: (appId: string, id: string) =>
      `/api/job-applications/${appId}/attachments/${id}`,
  };
}

describe("F07/M3 · notas e anexos", () => {
  it("registra texto e arquivos com a data trocada antes de salvar", async () => {
    const a = api();
    renderApp({ api: a as never, initialUrl: "/candidaturas/a1" });
    const form = await screen.findByRole("form", { name: "Novo registro" });
    await userEvent.type(within(form).getByRole("textbox", { name: "Nota" }), "Feedback do case");
    const date = within(form).getByLabelText("Data do registro");
    await userEvent.clear(date);
    await userEvent.type(date, "2026-10-26");
    const file = new File(["oi"], "email.eml", { type: "message/rfc822" });
    await userEvent.upload(within(form).getByLabelText("Anexos"), file);
    await userEvent.click(within(form).getByRole("button", { name: "Salvar registro" }));
    await waitFor(() =>
      expect(a.createJobApplicationEntry).toHaveBeenCalledWith("a1", {
        occurredOn: "2026-10-26",
        body: "Feedback do case",
        files: [file],
      }),
    );
  });

  it("lista do mais recente: prévia de imagem e vídeo, PDF abre, o resto baixa; apagar pede confirmação", async () => {
    const a = api();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp({ api: a as never, initialUrl: "/candidaturas/a1" });
    const list = await screen.findByRole("list", { name: "Registros da candidatura" });
    const items = await within(list).findAllByRole("listitem");
    expect(items[0]).toHaveTextContent("24/10/2026");
    expect(items[1]).toHaveTextContent("E-mail da recrutadora");
    expect(
      within(items[0] as HTMLElement).getByRole("img", { name: "convite.png" }),
    ).toHaveAttribute("src", "/api/job-applications/a1/attachments/t1");
    expect(items[0]?.querySelector("video")).toHaveAttribute(
      "src",
      "/api/job-applications/a1/attachments/t2",
    );
    expect(
      within(items[0] as HTMLElement).getByRole("link", { name: /case\.pdf/ }),
    ).toHaveAttribute("target", "_blank");
    expect(
      within(items[0] as HTMLElement).getByRole("link", { name: /planilha\.xlsx/ }),
    ).toHaveAttribute("download");
    await userEvent.click(
      within(items[1] as HTMLElement).getByRole("button", { name: "Apagar registro" }),
    );
    await waitFor(() => expect(a.deleteJobApplicationEntry).toHaveBeenCalledWith("a1", "e1"));
  });

  it("edita o texto e a data", async () => {
    const a = api();
    renderApp({ api: a as never, initialUrl: "/candidaturas/a1" });
    const list = await screen.findByRole("list", { name: "Registros da candidatura" });
    const item = (await within(list).findAllByRole("listitem"))[1] as HTMLElement;
    await userEvent.click(within(item).getByRole("button", { name: "Editar registro" }));
    const text = within(item).getByRole("textbox", { name: "Nota" });
    await userEvent.clear(text);
    await userEvent.type(text, "E-mail com o horário");
    await userEvent.click(within(item).getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(a.patchJobApplicationEntry).toHaveBeenCalledWith("a1", "e1", {
        body: "E-mail com o horário",
        occurredOn: "2026-10-22",
      }),
    );
  });

  it("arquivo acima de 100 MB é recusado antes de enviar", async () => {
    const a = api();
    renderApp({ api: a as never, initialUrl: "/candidaturas/a1" });
    const form = await screen.findByRole("form", { name: "Novo registro" });
    const big = new File(["x"], "video.mp4", { type: "video/mp4" });
    Object.defineProperty(big, "size", { value: 101 * 1024 * 1024 });
    await userEvent.upload(within(form).getByLabelText("Anexos"), big);
    expect(await within(form).findByText(/acima de 100 MB/)).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Salvar registro" })).toBeDisabled();
  });
});
