import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileDropzone } from "../../src/features/onboarding/components/FileDropzone";

const pdf = () => new File([new Uint8Array(10)], "cv.pdf", { type: "application/pdf" });

describe("FileDropzone · PDF/DOCX/MD até 10 MB", () => {
  it("aceita PDF e mostra nome e tamanho; permite remover", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<FileDropzone value={null} onChange={onChange} />);
    await userEvent.upload(screen.getByLabelText("escolher arquivo"), pdf());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: "cv.pdf" }));
    rerender(<FileDropzone value={pdf()} onChange={onChange} />);
    expect(screen.getByText("Arquivo selecionado: cv.pdf (10 B)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remover" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("rejeita tipo não aceito e arquivo grande com mensagens", async () => {
    const onChange = vi.fn();
    render(<FileDropzone value={null} onChange={onChange} />);
    const input = screen.getByLabelText("escolher arquivo");
    const exe = new File([new Uint8Array(10)], "virus.exe", { type: "application/octet-stream" });
    await userEvent.upload(input, exe, { applyAccept: false });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tipo não aceito. Envie PDF, DOCX ou Markdown.",
    );
    expect(onChange).not.toHaveBeenCalled();
    const big = new File([new Uint8Array(1)], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    await userEvent.upload(input, big);
    expect(await screen.findByRole("alert")).toHaveTextContent("Arquivo acima de 10 MB.");
  });
});
