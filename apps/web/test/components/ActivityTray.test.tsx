import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ActivityTray } from "../../src/components/shell/ActivityTray";
import { job, renderWithProviders } from "../helpers";

describe("ActivityTray · bandeja de atividades", () => {
  it("mostra estado vazio quando não há jobs", async () => {
    renderWithProviders(<ActivityTray defaultOpen />, {
      api: { listJobs: async () => ({ jobs: [] }) },
    });
    expect(await screen.findByText("Nenhuma atividade em andamento.")).toBeInTheDocument();
  });

  it("lista jobs com etapa, progresso e status; WS atualiza o progresso", async () => {
    const { ws } = renderWithProviders(<ActivityTray defaultOpen />, {
      api: { listJobs: async () => ({ jobs: [job()] }) },
    });
    expect(await screen.findByText("Leitura da camada de texto")).toBeInTheDocument();
    expect(screen.getByText("Rodando")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
    expect(screen.getByTestId("activity-count")).toHaveTextContent("1");
    ws.emit({
      type: "job.progress",
      jobId: "run1__ingest.read_text",
      stage: "ingest.read_text",
      progress: 70,
    });
    await waitFor(() =>
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "70"),
    );
  });

  it("mostra 'Reprocessando' para stalled e erro com 'Tentar de novo' que chama a API", async () => {
    const retryJob = vi.fn(async () => job({ status: "queued" }));
    renderWithProviders(<ActivityTray defaultOpen />, {
      api: {
        listJobs: async () => ({
          jobs: [
            job({ id: "a", status: "stalled" }),
            job({
              id: "b",
              status: "error",
              error: "OCR falhou",
              stage: "ocr.pages",
              type: "ocr.pages",
            }),
          ],
        }),
        retryJob,
      },
    });
    expect(await screen.findByText("Reprocessando")).toBeInTheDocument();
    expect(screen.getByText("OCR falhou")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(retryJob).toHaveBeenCalledWith("b");
  });

  it("cancela job ativo via API", async () => {
    const cancelJob = vi.fn(async () => job({ status: "cancelled" }));
    renderWithProviders(<ActivityTray defaultOpen />, {
      api: { listJobs: async () => ({ jobs: [job()] }), cancelJob },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(cancelJob).toHaveBeenCalledWith("run1__ingest.read_text");
  });
});
