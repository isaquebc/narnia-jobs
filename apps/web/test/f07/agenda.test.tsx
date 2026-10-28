import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";

/**
 * F07/M5 · agenda na candidatura (data e hora no fuso da pessoa, mostrando o fuso), Google Calendar e `.ics` sem conta,
 * lembretes no menu e na bandeja, funil na página de candidaturas.
 */
const app = {
  id: "a1",
  postingId: "v1",
  profileId: "p1",
  cv: { documentId: "d1", versionId: "dv2", version: 2, scope: "posting" },
  coverLetter: null,
  appliedOn: "2026-10-20",
  column: "in_process",
  closedReason: null,
  stages: [{ id: "st1", name: "Entrevista técnica", position: 1 }],
  currentStageId: "st1",
  lastActivityAt: "2026-10-20T12:00:00.000Z",
  archivedAt: null,
  createdAt: "2026-10-20T12:00:00.000Z",
  updatedAt: "2026-10-20T12:00:00.000Z",
  posting: { company: "Acme", client: null, title: "Backend Sr", role: "backend" },
  contacts: [],
  progress: { current: 1, total: 1 },
};

const event = (over: Record<string, unknown> = {}) => ({
  id: "ev1",
  applicationId: "a1",
  stageId: "st1",
  kind: "interview",
  title: "Entrevista técnica",
  startsAt: "2030-10-29T17:00:00.000Z",
  durationMin: 60,
  timezone: "America/Sao_Paulo",
  location: null,
  link: "https://meet.example/abc",
  notes: null,
  doneAt: null,
  icsSequence: 0,
  googleEventId: null,
  createdAt: "2026-10-20T12:00:00.000Z",
  updatedAt: "2026-10-20T12:00:00.000Z",
  ...over,
});

function api(over: Record<string, unknown> = {}) {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    listIngestions: async () => ({ runs: [] }),
    listChatSessions: async () => ({ sessions: [] }),
    listPendingNotes: async () => ({ notes: [] }),
    getJobApplication: async () => ({ application: app }),
    documentPdfUrl: () => "/x.pdf",
    listJobApplicationEntries: async () => ({ entries: [] }),
    listJobApplicationEvents: vi.fn(async () => ({
      events: [
        event(),
        event({ id: "ev0", title: "Bate-papo", startsAt: "2020-01-10T13:00:00.000Z" }),
      ],
    })),
    createJobApplicationEvent: vi.fn(async () => ({ event: event() })),
    patchJobApplicationEvent: vi.fn(async () => ({ event: event() })),
    deleteJobApplicationEvent: vi.fn(async () => null),
    jobApplicationEventIcsUrl: (appId: string, id: string) =>
      `/api/job-applications/${appId}/events/${id}/calendar.ics`,
    ...over,
  };
}

describe("F07/M5 · agenda da candidatura", () => {
  it("mostra a hora no fuso com o fuso; atrasado; Google e .ics; concluir", async () => {
    const a = api();
    renderApp({ api: a as never, initialUrl: "/candidaturas/a1" });
    const list = await screen.findByRole("list", { name: "Agenda da candidatura" });
    const items = await within(list).findAllByRole("listitem");
    const next = items.find((i) => i.textContent?.includes("Entrevista técnica")) as HTMLElement;
    expect(next).toHaveTextContent("29/10/2030 14:00");
    expect(next).toHaveTextContent("America/Sao_Paulo");
    const google = within(next).getByRole("link", { name: "Adicionar ao Google Calendar" });
    expect(google.getAttribute("href")).toMatch(
      /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE.*dates=20301029T170000Z%2F20301029T180000Z/,
    );
    expect(google).toHaveAttribute("target", "_blank");
    expect(within(next).getByRole("link", { name: "Baixar .ics" }).getAttribute("href")).toContain(
      "/api/job-applications/a1/events/ev1/calendar.ics?origin=",
    );
    const late = items.find((i) => i.textContent?.includes("Bate-papo")) as HTMLElement;
    expect(within(late).getByText("Atrasado")).toBeInTheDocument();
    await userEvent.click(within(late).getByRole("button", { name: "Concluir" }));
    await waitFor(() =>
      expect(a.patchJobApplicationEvent).toHaveBeenCalledWith("a1", "ev0", { done: true }),
    );
  });

  it("agenda no fuso da pessoa, com a etapa", async () => {
    const a = api({ listJobApplicationEvents: async () => ({ events: [] }) });
    renderApp({ api: a as never, initialUrl: "/candidaturas/a1" });
    const form = await screen.findByRole("form", { name: "Novo evento" });
    expect(within(form).getByText(/America\/Sao_Paulo/)).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText("Título"), "Entrevista técnica");
    await userEvent.selectOptions(within(form).getByLabelText("Etapa"), "st1");
    const when = within(form).getByLabelText("Data e hora");
    await userEvent.type(when, "2030-10-29T14:00");
    await userEvent.type(within(form).getByLabelText("Link"), "https://meet.example/abc");
    await userEvent.click(within(form).getByRole("button", { name: "Agendar" }));
    await waitFor(() =>
      expect(a.createJobApplicationEvent).toHaveBeenCalledWith("a1", {
        kind: "interview",
        title: "Entrevista técnica",
        stageId: "st1",
        startsLocal: "2030-10-29T14:00",
        timezone: "America/Sao_Paulo",
        durationMin: 60,
        location: null,
        link: "https://meet.example/abc",
        notes: null,
      }),
    );
  });
});

describe("F07/M5 · lembretes e funil", () => {
  const reminder = (id: string, title: string, startsAt: string) => ({
    event: event({ id, title, startsAt }),
    application: { id: "a1", company: "Acme", title: "Backend Sr" },
  });

  it("badge no menu e itens na bandeja (próximas 24 h e atrasados)", async () => {
    renderApp({
      api: api({
        listJobApplications: async () => ({ applications: [], saved: [] }),
        getJobApplicationFunnel: async () => ({
          total: 0,
          columns: [],
          rates: [],
          closedReasons: {},
        }),
        getJobApplicationUpcoming: async () => ({
          upcoming: [reminder("e1", "Entrevista técnica", "2030-10-29T17:00:00.000Z")],
          overdue: [reminder("e2", "Entregar o case", "2020-10-29T17:00:00.000Z")],
        }),
      }) as never,
      initialUrl: "/candidaturas",
    });
    expect(await screen.findByLabelText("Lembretes de candidaturas: 2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Atividades" }));
    const tray = await screen.findByRole("list", { name: "Agenda das candidaturas" });
    expect(within(tray).getByText(/Entrevista técnica · Acme/)).toBeInTheDocument();
    expect(within(tray).getByText(/Atrasado: Entregar o case · Acme/)).toBeInTheDocument();
  });

  it("funil com contagens, taxa de avanço e dias médios; sem dados não divide por zero", async () => {
    renderApp({
      api: api({
        listJobApplications: async () => ({ applications: [], saved: [] }),
        getJobApplicationFunnel: async () => ({
          total: 4,
          columns: [
            { column: "applied", now: 1, reached: 4, avgDays: 7.3 },
            { column: "first_interview", now: 0, reached: 3, avgDays: 2.5 },
            { column: "in_process", now: 1, reached: 2, avgDays: null },
            { column: "offer", now: 1, reached: 1, avgDays: null },
            { column: "closed", now: 1, reached: 1, avgDays: null },
          ],
          rates: [
            { from: "applied", to: "first_interview", rate: 0.75 },
            { from: "first_interview", to: "in_process", rate: 2 / 3 },
            { from: "in_process", to: "offer", rate: null },
          ],
          closedReasons: { rejected: 1 },
        }),
      }) as never,
      initialUrl: "/candidaturas",
    });
    const funnel = await screen.findByRole("region", { name: "Funil das candidaturas" });
    expect(within(funnel).getByText("75%")).toBeInTheDocument();
    expect(within(funnel).getByText("67%")).toBeInTheDocument();
    expect(within(funnel).getByText("—")).toBeInTheDocument();
    expect(within(funnel).getByText(/7,3 dias/)).toBeInTheDocument();
    expect(within(funnel).getByText(/Não aprovado: 1/)).toBeInTheDocument();
  });
});
