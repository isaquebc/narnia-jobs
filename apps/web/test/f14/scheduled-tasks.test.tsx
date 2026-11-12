import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProcessesPage } from "../../src/features/processes/ProcessesPage";
import { renderWithProviders } from "../helpers";

/**
 * F14/M1 · Processos › Tarefas agendadas (F14-12): cada tarefa com a última e a próxima execução, intervalo editável
 * (com o mínimo), pausar, rodar agora; o histórico e o detalhe com o log e o que a execução tocou.
 */
const run = {
  id: "r1",
  taskId: "job_applications.archive" as const,
  trigger: "schedule" as const,
  status: "done" as const,
  startedAt: "2026-11-11T12:00:00.000Z",
  finishedAt: "2026-11-11T12:00:01.000Z",
  counts: { archived: 1 },
  error: null,
  itemCount: 1,
};
const task = (id: "captures.prune" | "job_applications.archive", over = {}) => ({
  id,
  intervalMinutes: 1440,
  defaultIntervalMinutes: 1440,
  minIntervalMinutes: 60,
  paused: false,
  nextRunAt: "2026-11-12T12:00:00.000Z",
  lastRun: id === "job_applications.archive" ? run : null,
  running: false,
  ...over,
});

function api() {
  return {
    listJobs: async () => ({ jobs: [] }),
    listScheduledTasks: vi.fn(async () => ({
      tasks: [task("captures.prune"), task("job_applications.archive")],
    })),
    patchScheduledTask: vi.fn(async (id: string, patch: object) => task(id as never, patch)),
    runScheduledTask: vi.fn(async () => ({ jobId: "j", enqueued: true })),
    listScheduledRuns: vi.fn(async () => ({ runs: [run] })),
    getScheduledRun: vi.fn(async () => ({
      ...run,
      log: [
        {
          id: 1,
          at: run.startedAt,
          level: "info" as const,
          message: "1 candidatura(s) arquivada(s) por inatividade",
        },
      ],
      items: [
        {
          id: 1,
          at: run.startedAt,
          kind: "job_application",
          refId: "a1",
          label: "Dev Backend · Acme",
          action: "arquivada",
          result: "ok" as const,
          detail: null,
          href: "/candidaturas/a1",
        },
      ],
    })),
  };
}

async function openTab() {
  await userEvent.click(await screen.findByRole("tab", { name: "Tarefas agendadas" }));
}

describe("F14/M1 · Processos › Tarefas agendadas", () => {
  it("a aba Processos continua sendo a primeira; a nova lista as tarefas com nome, intervalo e execuções", async () => {
    const a = api();
    renderWithProviders(<ProcessesPage />, { api: a as never });
    expect(
      await screen.findByRole("tab", { name: "Processos", selected: true }),
    ).toBeInTheDocument();
    expect(a.listScheduledTasks).not.toHaveBeenCalled();
    await openTab();
    const prune = await screen.findByRole("region", { name: "Limpeza das capturas da extensão" });
    expect(within(prune).getByText("Nunca rodou")).toBeInTheDocument();
    const archive = screen.getByRole("region", { name: "Arquivamento de candidaturas paradas" });
    expect(within(archive).getByText(/Concluída/)).toBeInTheDocument();
    expect(within(archive).getByLabelText("Intervalo (minutos)")).toHaveValue(1440);
  });

  it("muda o intervalo, pausa e roda agora", async () => {
    const a = api();
    renderWithProviders(<ProcessesPage />, { api: a as never });
    await openTab();
    const prune = await screen.findByRole("region", { name: "Limpeza das capturas da extensão" });
    const input = within(prune).getByLabelText("Intervalo (minutos)");
    await userEvent.clear(input);
    await userEvent.type(input, "120");
    await userEvent.click(within(prune).getByRole("button", { name: "Salvar intervalo" }));
    await waitFor(() =>
      expect(a.patchScheduledTask).toHaveBeenCalledWith("captures.prune", { intervalMinutes: 120 }),
    );
    await userEvent.click(within(prune).getByRole("switch", { name: "Pausada" }));
    await waitFor(() =>
      expect(a.patchScheduledTask).toHaveBeenCalledWith("captures.prune", { paused: true }),
    );
    await userEvent.click(within(prune).getByRole("button", { name: "Rodar agora" }));
    await waitFor(() => expect(a.runScheduledTask).toHaveBeenCalledWith("captures.prune"));
  });

  it("intervalo abaixo do mínimo não salva e mostra o mínimo", async () => {
    const a = api();
    renderWithProviders(<ProcessesPage />, { api: a as never });
    await openTab();
    const prune = await screen.findByRole("region", { name: "Limpeza das capturas da extensão" });
    const input = within(prune).getByLabelText("Intervalo (minutos)");
    await userEvent.clear(input);
    await userEvent.type(input, "5");
    expect(within(prune).getByRole("button", { name: "Salvar intervalo" })).toBeDisabled();
    expect(within(prune).getByText("Mínimo: 60 minutos")).toBeInTheDocument();
  });

  it("histórico: abre a execução com o log e os itens, com link para o alvo", async () => {
    const a = api();
    renderWithProviders(<ProcessesPage />, { api: a as never });
    await openTab();
    const archive = await screen.findByRole("region", {
      name: "Arquivamento de candidaturas paradas",
    });
    await userEvent.click(within(archive).getByRole("button", { name: "Ver histórico" }));
    await userEvent.click(await within(archive).findByRole("button", { name: /Concluída/ }));
    const detail = await within(archive).findByRole("region", { name: "Detalhe da execução" });
    expect(
      within(detail).getByText("1 candidatura(s) arquivada(s) por inatividade"),
    ).toBeInTheDocument();
    const link = within(detail).getByRole("link", { name: "Dev Backend · Acme" });
    expect(link).toHaveAttribute("href", "/candidaturas/a1");
    expect(within(detail).getByText("arquivada")).toBeInTheDocument();
    expect(a.getScheduledRun).toHaveBeenCalledWith("r1");
  });

  it("rodar agora com uma execução já na fila avisa em vez de calar", async () => {
    const a = { ...api(), runScheduledTask: vi.fn(async () => ({ jobId: "j", enqueued: false })) };
    renderWithProviders(<ProcessesPage />, { api: a as never });
    await openTab();
    const prune = await screen.findByRole("region", { name: "Limpeza das capturas da extensão" });
    await userEvent.click(within(prune).getByRole("button", { name: "Rodar agora" }));
    expect(
      await within(prune).findByText("Já há uma execução desta tarefa na fila ou rodando."),
    ).toBeInTheDocument();
  });

  it("leitura do Gmail: desfazer daqui em diante, com confirmação e o resumo (erro num e-mail é avisado; leitura pausada)", async () => {
    const mailRun = { ...run, id: "m1", taskId: "mail.sync" as const, counts: { digested: 3 } };
    const a = {
      ...api(),
      listScheduledTasks: vi.fn(async () => ({
        tasks: [{ ...task("job_applications.archive"), id: "mail.sync", lastRun: mailRun }],
      })),
      listScheduledRuns: vi.fn(async () => ({ runs: [mailRun] })),
      getScheduledRun: vi.fn(async () => ({ ...mailRun, log: [], items: [] })),
      redoMailRuns: vi.fn(async () => ({
        mails: 3,
        applicationsRemoved: 1,
        postingsRemoved: 2,
        kept: [
          {
            gmailId: "g9",
            subject: "Recebemos sua candidatura",
            reason: "não deu para desfazer: falhou",
          },
        ],
      })),
    };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<ProcessesPage />, { api: a as never });
    await openTab();
    const card = await screen.findByRole("region", { name: "Leitura do Gmail" });
    await userEvent.click(within(card).getByRole("button", { name: "Ver histórico" }));
    // o botão aparece na linha da execução, sem abrir o detalhe (o dono não achou escondido)
    await userEvent.click(
      await within(card).findByRole("button", { name: "Desfazer daqui em diante" }),
    );
    expect(confirm).toHaveBeenCalled();
    expect(a.redoMailRuns).toHaveBeenCalledWith("m1");
    const status = await within(card).findByRole("status");
    expect(status).toHaveTextContent(
      "3 e-mail(s) voltaram para a fila; 1 candidatura(s) e 2 vaga(s) apagadas. A leitura automática está pausada",
    );
    expect(status).toHaveTextContent("Recebemos sua candidatura: não deu para desfazer: falhou");
    confirm.mockRestore();
  });

  it("leitura do Gmail: atalho no cartão desfaz todas as leituras, sem abrir o histórico", async () => {
    const empty = { ...run, id: "m2", taskId: "mail.sync" as const, counts: {} };
    const withMail = { ...run, id: "m1", taskId: "mail.sync" as const, counts: { digested: 3 } };
    const a = {
      ...api(),
      listScheduledTasks: vi.fn(async () => ({
        tasks: [{ ...task("job_applications.archive"), id: "mail.sync", lastRun: empty }],
      })),
      listScheduledRuns: vi.fn(async () => ({ runs: [empty, withMail] })),
      redoMailRuns: vi.fn(async () => ({
        mails: 3,
        applicationsRemoved: 0,
        postingsRemoved: 0,
        kept: [],
      })),
    };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<ProcessesPage />, { api: a as never });
    await openTab();
    const card = await screen.findByRole("region", { name: "Leitura do Gmail" });
    await userEvent.click(
      await within(card).findByRole("button", {
        name: "Desfazer todas as leituras",
      }),
    );
    expect(a.redoMailRuns).toHaveBeenCalledWith(null);
    expect(within(card).queryByRole("button", { name: "Esconder histórico" })).toBeNull();
    // no histórico, a leitura vazia não tem o botão (ele não desfaria nada)
    await userEvent.click(within(card).getByRole("button", { name: "Ver histórico" }));
    await within(card).findAllByRole("button", { name: /Concluída/ });
    expect(within(card).getAllByRole("button", { name: "Desfazer daqui em diante" })).toHaveLength(
      1,
    );
    confirm.mockRestore();
  });
});
