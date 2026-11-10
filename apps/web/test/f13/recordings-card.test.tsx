import type { Recording } from "@narnia-jobs/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetUploads } from "../../src/features/recordings/uploads";
import { ApiError } from "../../src/lib/api";
import { profile } from "../components/profile-fixture";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";

/**
 * F13/M1.5 · envio do vídeo na etapa da candidatura e avulso no perfil (F13-3, R5, R6): escolher a etapa, progresso,
 * retomada com o mesmo arquivo, reprodução, apagar só o vídeo ou tudo; aviso quando a análise está desligada.
 */
afterEach(() => resetUploads());

const rec = (over: Partial<Recording> = {}): Recording => ({
  id: "r1",
  profileId: "p1",
  jobApplicationId: "a1",
  stageId: "st2",
  title: null,
  state: "uploaded",
  fileName: "call.webm",
  mime: "video/webm",
  size: 20,
  received: 20,
  hasVideo: true,
  durationS: null,
  error: null,
  step: null,
  progress: 0,
  language: null,
  meetingStartS: null,
  approximate: false,
  analyzedAt: null,
  createdAt: "2026-11-10T12:00:00.000Z",
  updatedAt: "2026-11-10T12:00:00.000Z",
  ...over,
});

const app = {
  id: "a1",
  postingId: "v1",
  profileId: "p1",
  cv: { documentId: "d1", versionId: "dv2", version: 2, scope: "posting" },
  coverLetter: null,
  appliedOn: "2026-10-20",
  column: "in_process",
  closedReason: null,
  stages: [
    { id: "st1", name: "RH", position: 1 },
    { id: "st2", name: "Técnica", position: 2 },
  ],
  currentStageId: "st2",
  lastActivityAt: "2026-10-20T12:00:00.000Z",
  archivedAt: null,
  createdAt: "2026-10-20T12:00:00.000Z",
  updatedAt: "2026-10-20T12:00:00.000Z",
  posting: { company: "Acme", client: null, title: "Backend Sr", role: "backend" },
  contacts: [],
  progress: { current: 2, total: 2 },
};

/** Servidor falso das entrevistas: lista, cria e recebe partes conferindo o offset. */
function api(list: Recording[] = []) {
  let items = [...list];
  const set = (r: Recording) => {
    items = [r, ...items.filter((x) => x.id !== r.id)];
    return r;
  };
  const a = {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    listIngestions: async () => ({ runs: [] }),
    listChatSessions: async () => ({ sessions: [] }),
    listPendingNotes: async () => ({ notes: [] }),
    getJobApplication: async () => ({ application: app }),
    documentPdfUrl: () => "/x.pdf",
    listJobApplicationEntries: async () => ({ entries: [] }),
    listJobApplicationEvents: async () => ({ events: [] }),
    listPostingContacts: async () => ({ contacts: [] }),
    listRecordings: vi.fn(async () => ({ recordings: items })),
    createRecording: vi.fn(async (input: { fileName: string; size: number; stageId?: string }) =>
      set(
        rec({
          id: "new",
          fileName: input.fileName,
          size: input.size,
          stageId: input.stageId ?? null,
          state: "uploading",
          received: 0,
          hasVideo: false,
        }),
      ),
    ),
    putRecordingChunk: vi.fn(async (id: string, offset: number, blob: Blob) => {
      const cur = items.find((x) => x.id === id) as Recording;
      if (offset !== cur.received)
        throw new ApiError(409, "offset_mismatch", "Parte fora de ordem.", {
          received: cur.received,
        });
      const received = cur.received + blob.size;
      const done = received === cur.size;
      return set({ ...cur, received, state: done ? "uploaded" : "uploading", hasVideo: done });
    }),
    deleteRecordingVideo: vi.fn(async (id: string) =>
      set({ ...(items.find((x) => x.id === id) as Recording), hasVideo: false }),
    ),
    deleteRecording: vi.fn(async (id: string) => {
      items = items.filter((x) => x.id !== id);
    }),
    recordingVideoUrl: (id: string) => `/api/recordings/${id}/video`,
  };
  return a;
}

const video = (n = 20, name = "call.webm") =>
  new File([new Uint8Array(n)], name, { type: "video/webm" });

describe("F13/M1.5 · entrevistas gravadas na candidatura", () => {
  it("envia na etapa escolhida, mostra o aviso de análise desligada e o vídeo pronto", async () => {
    const a = api();
    renderApp({ api: a as never, initialUrl: "/candidaturas/a1" });
    const c = await screen.findByRole("region", { name: "Entrevistas gravadas" });
    expect(await within(c).findByText(/análise de vídeo está desligada/i)).toBeInTheDocument();
    expect(within(c).getByText(/fixe a sua câmera/i)).toBeInTheDocument();
    const form = within(c).getByRole("form", { name: "Enviar entrevista" });
    await userEvent.selectOptions(within(form).getByLabelText("Etapa"), "st2");
    await userEvent.upload(within(form).getByLabelText("Vídeo da entrevista"), video());
    await userEvent.click(within(form).getByRole("button", { name: "Enviar vídeo" }));
    await waitFor(() =>
      expect(a.createRecording).toHaveBeenCalledWith({
        jobApplicationId: "a1",
        stageId: "st2",
        fileName: "call.webm",
        size: 20,
        mime: "video/webm",
      }),
    );
    const list = within(c).getByRole("list", { name: "Entrevistas desta candidatura" });
    const item = await within(list).findByRole("listitem");
    await waitFor(() => expect(item.querySelector("video")).not.toBeNull());
    expect(item.querySelector("video")).toHaveAttribute("src", "/api/recordings/new/video");
    expect(item).toHaveTextContent("Técnica");
    expect(item).toHaveTextContent("Enviada, aguardando análise");
  });

  it("recusa do servidor aparece no formulário", async () => {
    const a = api();
    a.createRecording.mockRejectedValueOnce(
      new ApiError(413, "too_large", "O vídeo tem 5,0 GB; o limite é 4,0 GB."),
    );
    renderApp({ api: a as never, initialUrl: "/candidaturas/a1" });
    const form = await screen.findByRole("form", { name: "Enviar entrevista" });
    await userEvent.upload(within(form).getByLabelText("Vídeo da entrevista"), video());
    await userEvent.click(within(form).getByRole("button", { name: "Enviar vídeo" }));
    expect(await within(form).findByText(/limite é 4,0 GB/)).toBeInTheDocument();
  });

  it("envio parado: retoma com o mesmo arquivo, recusa outro", async () => {
    const a = api([rec({ state: "uploading", received: 8, hasVideo: false })]);
    renderApp({ api: a as never, initialUrl: "/candidaturas/a1" });
    const item = await screen.findByRole("listitem", { name: "call.webm" });
    expect(item).toHaveTextContent(/parado em 40%/i);
    const input = within(item).getByLabelText("Continuar o envio de call.webm");
    await userEvent.upload(input, video(19));
    expect(await within(item).findByText(/não é o mesmo arquivo/i)).toBeInTheDocument();
    expect(a.putRecordingChunk).not.toHaveBeenCalled();
    // a tentativa recusada troca o campo (progresso → erro): pega o campo de novo
    await userEvent.upload(
      within(item).getByLabelText("Continuar o envio de call.webm"),
      video(20),
    );
    await waitFor(() =>
      expect(a.putRecordingChunk).toHaveBeenCalledWith("r1", 8, expect.any(Blob)),
    );
    await waitFor(() => expect(item.querySelector("video")).not.toBeNull());
  });

  it("apagar só o vídeo mantém a entrevista; apagar tudo remove", async () => {
    const a = api([rec()]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderApp({ api: a as never, initialUrl: "/candidaturas/a1" });
    const item = await screen.findByRole("listitem", { name: "call.webm" });
    await userEvent.click(within(item).getByRole("button", { name: "Apagar só o vídeo" }));
    await waitFor(() => expect(a.deleteRecordingVideo).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(item.querySelector("video")).toBeNull());
    expect(item).toHaveTextContent(/vídeo apagado/i);
    await userEvent.click(within(item).getByRole("button", { name: "Apagar entrevista" }));
    await waitFor(() => expect(a.deleteRecording).toHaveBeenCalledWith("r1"));
    expect(await screen.findByText("Nenhuma entrevista gravada ainda.")).toBeInTheDocument();
  });
});

describe("F13/M1.5 · envio avulso no perfil", () => {
  it("aba Entrevistas do perfil: cria com o perfil e sem etapa", async () => {
    const a = { ...api(), getProfile: async (id: string) => profile(id, { name: "Eng" }) };
    renderApp({ api: a as never, initialUrl: "/perfis/p1/entrevistas" });
    expect(await screen.findByRole("link", { name: "Entrevistas" })).toBeInTheDocument();
    const form = await screen.findByRole("form", { name: "Enviar entrevista" });
    expect(within(form).queryByLabelText("Etapa")).toBeNull();
    await userEvent.type(within(form).getByLabelText("Título (opcional)"), "Treino com amigo");
    await userEvent.upload(within(form).getByLabelText("Vídeo da entrevista"), video());
    await userEvent.click(within(form).getByRole("button", { name: "Enviar vídeo" }));
    await waitFor(() =>
      expect(a.createRecording).toHaveBeenCalledWith({
        profileId: "p1",
        title: "Treino com amigo",
        fileName: "call.webm",
        size: 20,
        mime: "video/webm",
      }),
    );
    expect(a.listRecordings).toHaveBeenCalledWith({ profileId: "p1" });
  });
});
