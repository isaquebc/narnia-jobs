import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgendaCard } from "../../src/features/job-applications/AgendaCard";
import { MailActivityCard } from "../../src/features/job-applications/MailActivityCard";
import { renderWithProviders } from "../helpers";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
}));

/** F14/M6 · "Pelo e-mail" na candidatura (sugestão, desfazer, histórico) e a etapa provisória na agenda. */
const app = {
  id: "a1",
  postingId: "v1",
  profileId: "p1",
  cv: null,
  coverLetter: null,
  appliedOn: "2026-10-20",
  column: "applied",
  closedReason: null,
  stages: [
    { id: "st1", name: "Bate-papo com Talent", position: 0 },
    { id: "st2", name: "Entrevista técnica", position: 1 },
  ],
  currentStageId: "st1",
  lastActivityAt: "2026-10-20T12:00:00.000Z",
  archivedAt: null,
  createdAt: "2026-10-20T12:00:00.000Z",
  updatedAt: "2026-10-20T12:00:00.000Z",
  posting: { company: "Acme", client: null, title: "Backend Sr", role: "backend" },
  contacts: [],
  progress: { current: 1, total: 2 },
} as never;

const activity = {
  mails: [
    {
      id: "m1",
      gmailId: "g1",
      subject: "Próxima etapa",
      from: "RH Acme",
      receivedAt: "2026-11-03T10:00:00.000Z",
      class: "update",
      summary: "Passou para a técnica.",
      undoneAt: null,
      canUndo: true,
      mailUrl: "https://mail.google.com/mail/u/0/#all/g1",
    },
  ],
  suggestions: [
    {
      id: "s1",
      toStageId: "st2",
      toStageName: "Entrevista técnica",
      hint: "Entrevista técnica",
      confidence: 92,
      createdAt: "2026-11-03T10:00:00.000Z",
      mailMessageId: "m1",
    },
  ],
  stageChanges: [
    {
      id: "c1",
      at: "2026-11-01T10:00:00.000Z",
      source: "email",
      mailMessageId: "m0",
      fromStageName: null,
      toStageName: "Bate-papo com Talent",
    },
  ],
};

describe("F14/M6 · pelo e-mail", () => {
  it("aprova a sugestão (etapa já escolhida), desfaz o e-mail e mostra a origem no histórico", async () => {
    const approveStageSuggestion = vi.fn(async () => ({ application: {} }));
    const undoMail = vi.fn(async () => ({ applicationId: "a1", applicationRemoved: false }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<MailActivityCard application={app} />, {
      api: { getMailActivity: async () => activity, approveStageSuggestion, undoMail } as never,
    });
    const s = await screen.findByRole("list", { name: "Etapas sugeridas pelo e-mail" });
    expect(
      within(s).getByText("Um e-mail diz que a candidatura passou para Entrevista técnica."),
    ).toBeInTheDocument();
    await userEvent.click(within(s).getByRole("button", { name: "Mover" }));
    await waitFor(() => expect(approveStageSuggestion).toHaveBeenCalledWith("s1", "st2"));
    const mails = screen.getByRole("list", { name: "E-mails desta candidatura" });
    await userEvent.click(within(mails).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(undoMail).toHaveBeenCalledWith("m1"));
    const h = screen.getByRole("list", { name: "Histórico das etapas" });
    expect(within(h).getByText(/pelo e-mail/)).toBeInTheDocument();
  });

  it("cada e-mail da candidatura tem Ler de novo", async () => {
    const rereadMail = vi.fn(async () => ({
      mails: 1,
      applicationsRemoved: 0,
      postingsRemoved: 0,
      kept: [],
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<MailActivityCard application={app} />, {
      api: { getMailActivity: async () => activity, rereadMail } as never,
    });
    const mails = await screen.findByRole("list", { name: "E-mails desta candidatura" });
    await userEvent.click(within(mails).getByRole("button", { name: "Ler de novo" }));
    await waitFor(() => expect(rereadMail).toHaveBeenCalledWith("m1"));
  });

  it("desfazer a confirmação que criou a candidatura volta para a lista", async () => {
    navigate.mockClear();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<MailActivityCard application={app} />, {
      api: {
        getMailActivity: async () => ({ ...activity, suggestions: [] }),
        undoMail: async () => ({ applicationId: null, applicationRemoved: true }),
      } as never,
    });
    await userEvent.click(await screen.findByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/candidaturas" }));
  });

  it("sem nada vindo de e-mail, o cartão não aparece", async () => {
    const { container } = renderWithProviders(<MailActivityCard application={app} />, {
      api: {
        getMailActivity: async () => ({ mails: [], suggestions: [], stageChanges: [] }),
      } as never,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("etapa provisória: selo, explicação e bloquear a agenda", async () => {
    const blockJobApplicationEvent = vi.fn(async () => ({ event: {} }));
    renderWithProviders(<AgendaCard application={app} />, {
      api: {
        listJobApplicationEvents: async () => ({
          events: [
            {
              id: "ev1",
              applicationId: "a1",
              stageId: "st2",
              kind: "interview",
              title: "Entrevista técnica",
              startsAt: "2030-11-12T17:00:00.000Z",
              durationMin: 60,
              timezone: "America/Sao_Paulo",
              location: null,
              link: null,
              notes: null,
              doneAt: null,
              icsSequence: 0,
              googleEventId: null,
              provisional: true,
              icsUid: null,
              blockedAt: null,
              cancelledAt: null,
              mailMessageId: "m1",
              createdAt: "2026-11-03T10:00:00.000Z",
              updatedAt: "2026-11-03T10:00:00.000Z",
            },
          ],
        }),
        jobApplicationEventIcsUrl: () => "/x.ics",
        blockJobApplicationEvent,
      } as never,
    });
    expect(await screen.findByText("Provisória")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Bloquear agenda" }));
    await waitFor(() => expect(blockJobApplicationEvent).toHaveBeenCalledWith("a1", "ev1", true));
  });
});
