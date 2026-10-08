import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  PhoneInput,
  validatePhoneParts,
} from "../../src/features/onboarding/components/PhoneInput";

describe("PhoneInput · país + DDD + número", () => {
  it("valida as partes: DDD e número para o Brasil", () => {
    expect(validatePhoneParts({ country: "BR", area: "11", number: "999999999" })).toEqual({
      ok: true,
      national: "11999999999",
    });
    expect(validatePhoneParts({ country: "BR", area: "1", number: "999999999" })).toMatchObject({
      ok: false,
      field: "area",
    });
    expect(validatePhoneParts({ country: "BR", area: "11", number: "12" })).toMatchObject({
      ok: false,
      field: "number",
    });
    expect(validatePhoneParts({ country: "PT", area: "", number: "912345678" })).toEqual({
      ok: true,
      national: "912345678",
    });
  });

  it("mostra erro ao sair do campo com DDD inválido e emite o valor quando válido", async () => {
    const onChange = vi.fn();
    render(<PhoneInput value={{ country: "BR", area: "", number: "" }} onChange={onChange} />);
    const area = screen.getByLabelText("DDD");
    await userEvent.type(area, "1");
    await userEvent.tab();
    expect(await screen.findByRole("alert")).toHaveTextContent("DDD inválido.");
    expect(onChange).toHaveBeenLastCalledWith({ country: "BR", area: "1", number: "" });
  });

  it("troca de país muda o código discado exibido", async () => {
    const onChange = vi.fn();
    render(
      <PhoneInput value={{ country: "BR", area: "11", number: "999999999" }} onChange={onChange} />,
    );
    expect(screen.getByText("+55")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("País"), "PT");
    expect(onChange).toHaveBeenLastCalledWith({ country: "PT", area: "11", number: "999999999" });
  });
});
