import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EstimateBadge } from "../../src/features/onboarding/components/EstimateBadge";
import { ExtractionOptions } from "../../src/features/onboarding/components/ExtractionOptions";
import { ReadingOriginBadge } from "../../src/features/onboarding/components/ReadingOriginBadge";

describe("ExtractionOptions · OCR e leitura pelo modelo", () => {
  it("só aparece para PDF e emite as opções ao alternar", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ExtractionOptions
        isPdf={false}
        value={{ ocr: true, modelRead: true }}
        onChange={onChange}
      />,
    );
    expect(screen.queryByText("Leituras do PDF")).not.toBeInTheDocument();
    rerender(
      <ExtractionOptions isPdf value={{ ocr: true, modelRead: true }} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("switch", { name: "Leitura do documento pelo modelo" }));
    expect(onChange).toHaveBeenCalledWith({ ocr: true, modelRead: false });
  });
});

describe("EstimateBadge", () => {
  it("mostra total e uma linha por chamada com modelo", () => {
    render(
      <EstimateBadge
        loading={false}
        estimate={{
          totalTokens: 11000,
          calls: [
            { name: "readDocument", model: "haiku", tokens: 3000 },
            { name: "extractFacts", model: "haiku", tokens: 4000 },
            { name: "buildDigest", model: "sonnet", tokens: 4000 },
          ],
        }}
      />,
    );
    expect(screen.getByText("~11k tokens no total")).toBeInTheDocument();
    expect(screen.getByText("Registro de contexto: ~4k tokens (sonnet)")).toBeInTheDocument();
  });
  it("mostra carregando e indisponível", () => {
    const { rerender } = render(<EstimateBadge loading estimate={null} />);
    expect(screen.getByText("Calculando…")).toBeInTheDocument();
    rerender(<EstimateBadge loading={false} estimate={null} />);
    expect(screen.getByText("Estimativa indisponível.")).toBeInTheDocument();
  });
});

describe("ReadingOriginBadge", () => {
  it("rotula texto/OCR/modelo e marca divergência", () => {
    const { rerender } = render(<ReadingOriginBadge origin="ocr" />);
    expect(screen.getByText("OCR")).toBeInTheDocument();
    rerender(<ReadingOriginBadge origin="model_read" divergent />);
    expect(screen.getByText("leitura pelo modelo")).toBeInTheDocument();
    expect(screen.getByTitle("leituras divergiram neste trecho")).toBeInTheDocument();
    rerender(<ReadingOriginBadge origin={null} />);
    expect(screen.queryByText(/leitura/)).not.toBeInTheDocument();
  });
});
