import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProcessesPage } from "../../src/features/processes/ProcessesPage";
import { CvTemplatesSection } from "../../src/features/settings/CvTemplatesSection";
import { WorkerSettingsSection } from "../../src/features/settings/WorkerSettingsSection";
import { job, renderWithProviders } from "../helpers";

/** F05/M7 · modelos de currículo enviados, processos em segundo plano e concorrência. */
describe("F05/M7 · Configurações › Modelos de currículo", () => {
  const templates = {
    templates: [
      {
        id: "classico",
        name: "Clássico",
        origin: "builtin",
        status: "valid",
        validationErrors: [],
        hasPreview: false,
      },
      {
        id: "t1",
        name: "Meu modelo",
        origin: "user",
        status: "valid",
        validationErrors: [],
        hasPreview: true,
      },
      {
        id: "t2",
        name: "Quebrado",
        origin: "user",
        status: "invalid",
        validationErrors: ["<script> não é permitido."],
        hasPreview: false,
      },
    ],
  };

  it("lista padrão e enviados com o status, os motivos do inválido e a prévia; envia e apaga", async () => {
    const uploadCvTemplate = vi.fn(async () => ({ template: { id: "t3", status: "validating" } }));
    const deleteCvTemplate = vi.fn(async () => null);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<CvTemplatesSection />, {
      api: {
        listCvTemplates: vi.fn(async () => templates),
        uploadCvTemplate,
        deleteCvTemplate,
        cvTemplatePreviewUrl: (id: string) => `/api/cv-templates/${id}/preview`,
      } as never,
    });
    expect(await screen.findByText("Meu modelo")).toBeInTheDocument();
    expect(screen.getByText("padrão")).toBeInTheDocument();
    expect(screen.getByText("inválido")).toBeInTheDocument();
    expect(screen.getByText("<script> não é permitido.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Prévia de Meu modelo" })).toHaveAttribute(
      "src",
      "/api/cv-templates/t1/preview",
    );
    const file = new File([new Uint8Array([0x50, 0x4b])], "novo.zip", { type: "application/zip" });
    await userEvent.upload(screen.getByLabelText("Enviar modelo (.zip)"), file);
    await waitFor(() => expect(uploadCvTemplate).toHaveBeenCalledWith(file));
    const row = screen.getByText("Quebrado").closest("li") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Apagar modelo" }));
    expect(deleteCvTemplate).toHaveBeenCalledWith("t2");
  });
});

describe("F05/M7 · processos e concorrência", () => {
  it("/processos: em andamento e recentes, com cancelar e tentar de novo", async () => {
    const cancelJob = vi.fn(async () => job({ id: "j1", status: "cancelled" }));
    const retryJob = vi.fn(async () => job({ id: "j2", status: "queued" }));
    renderWithProviders(<ProcessesPage />, {
      api: {
        listJobs: async () => ({
          jobs: [
            job({ id: "j1", status: "active", stage: "cv.generate" }),
            job({ id: "j2", status: "error", stage: "posting.extract", error: "falhou" }),
          ],
        }),
        cancelJob,
        retryJob,
      } as never,
    });
    const running = await screen.findByRole("region", { name: "Em andamento e na fila" });
    expect(
      await within(running).findByText("Geração do currículo ou da carta"),
    ).toBeInTheDocument();
    await userEvent.click(within(running).getByRole("button", { name: "Cancelar" }));
    expect(cancelJob).toHaveBeenCalledWith("j1");
    const recent = screen.getByRole("region", { name: "Recentes" });
    await userEvent.click(within(recent).getByRole("button", { name: "Tentar de novo" }));
    expect(retryJob).toHaveBeenCalledWith("j2");
  });

  it("Configurações › Processos simultâneos: troca grava só a fila mudada", async () => {
    const settings = {
      concurrency: { ingest: 2, ocr: 1, extract: 2 },
      defaults: { ingest: 2, ocr: 1, extract: 2 },
      min: 1,
      max: 4,
    };
    const putWorkerSettings = vi.fn(async (p: Record<string, number>) => ({
      ...settings,
      concurrency: { ...settings.concurrency, ...p },
    }));
    renderWithProviders(<WorkerSettingsSection />, {
      api: { getWorkerSettings: async () => settings, putWorkerSettings } as never,
    });
    const extract = await screen.findByLabelText(/Modelo \(extração/);
    expect([...(extract as HTMLSelectElement).options].map((o) => o.value)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    await userEvent.selectOptions(extract, "3");
    expect(putWorkerSettings).toHaveBeenCalledWith({ extract: 3 });
    expect(await screen.findByText(/vale em até 15 segundos/)).toBeInTheDocument();
  });
});
