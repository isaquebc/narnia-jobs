import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProgressPanel } from "../../src/features/onboarding/components/ProgressPanel";
import { job } from "../helpers";

describe("ProgressPanel · etapas da cadeia", () => {
  it("lista as etapas planejadas com a atual em andamento", () => {
    render(
      <ProgressPanel
        status="running"
        jobs={[
          job({
            id: "a",
            type: "ingest.read_text",
            stage: "ingest.read_text",
            status: "done",
            progress: 100,
          }),
          job({ id: "b", type: "ocr.pages", stage: "ocr.pages", status: "active", progress: 40 }),
          job({
            id: "c",
            type: "extract.facts",
            stage: "extract.facts",
            status: "queued",
            progress: 0,
          }),
        ]}
        onRetryJob={() => {}}
        onSkip={() => {}}
        onContinue={() => {}}
      />,
    );
    expect(screen.getByText("Etapa 2 de 3")).toBeInTheDocument();
    expect(screen.getByText("OCR das páginas")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
  });

  it("erro em etapa oferece tentar de novo e pular para manual", async () => {
    const onRetryJob = vi.fn();
    const onSkip = vi.fn();
    render(
      <ProgressPanel
        status="error"
        jobs={[
          job({
            id: "b",
            type: "ocr.pages",
            stage: "ocr.pages",
            status: "error",
            error: "sem páginas",
          }),
        ]}
        onRetryJob={onRetryJob}
        onSkip={onSkip}
        onContinue={() => {}}
      />,
    );
    expect(screen.getByText("A etapa “OCR das páginas” falhou: sem páginas")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo a etapa" }));
    expect(onRetryJob).toHaveBeenCalledWith("b");
    await userEvent.click(screen.getByRole("button", { name: "Pular para preenchimento manual" }));
    expect(onSkip).toHaveBeenCalled();
  });

  it("concluído mostra o botão de continuar", async () => {
    const onContinue = vi.fn();
    render(
      <ProgressPanel
        status="review"
        jobs={[job({ id: "a", status: "done", progress: 100 })]}
        onRetryJob={() => {}}
        onSkip={() => {}}
        onContinue={onContinue}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Revisar o que foi extraído" }));
    expect(onContinue).toHaveBeenCalled();
  });
});
