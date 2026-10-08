import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProfileForm } from "../../../src/features/onboarding/components/ProfileForm";

const base = {
  suggestion: null,
  userCountry: "BR",
  reference: null,
  onSubmit: () => {},
};

describe("ProfileForm · onDirty (F02 §2.5, guarda de formulário)", () => {
  it("avisa uma vez ao primeiro toque e não repete quando o pai re-renderiza com outra função", async () => {
    // Regressão (F02/M5): após criar um perfil o seletor pedia confirmação para trocar, porque o efeito
    // `[touched, onDirty]` disparava de novo a cada identidade nova de `onDirty` (guard.setDirty(false) → re-render).
    const first = vi.fn();
    const { rerender } = render(<ProfileForm {...base} onDirty={first} />);
    await userEvent.type(screen.getByLabelText(/Nome do perfil/), "PM");
    expect(first).toHaveBeenCalledTimes(1);
    const second = vi.fn();
    rerender(<ProfileForm {...base} onDirty={second} />);
    rerender(<ProfileForm {...base} onDirty={vi.fn()} />);
    expect(second).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledTimes(1);
  });
});
