import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FreeTextEditor } from "../../src/features/onboarding/components/FreeTextEditor";

describe("FreeTextEditor · texto livre 200–50k", () => {
  it("mostra contador, mínimo e salva rascunho em localStorage", async () => {
    localStorage.removeItem("narnia.draft.cv");
    const onChange = vi.fn();
    const { rerender } = render(<FreeTextEditor value="" onChange={onChange} />);
    expect(screen.getByText("0 / 50000 caracteres")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox"), "abc");
    expect(onChange).toHaveBeenCalled();
    rerender(<FreeTextEditor value="abc" onChange={onChange} />);
    expect(screen.getByText("Escreva pelo menos 200 caracteres.")).toBeInTheDocument();
    expect(localStorage.getItem("narnia.draft.cv")).toBe("abc");
    const long = "x".repeat(250);
    rerender(<FreeTextEditor value={long} onChange={onChange} />);
    expect(screen.queryByText("Escreva pelo menos 200 caracteres.")).not.toBeInTheDocument();
    expect(screen.getByText("Rascunho salvo neste navegador.")).toBeInTheDocument();
  });
  it("não aceita além do máximo", () => {
    render(<FreeTextEditor value={"x".repeat(50_000)} onChange={() => {}} />);
    expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", "50000");
  });
});
