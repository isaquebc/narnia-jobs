import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  IdentityForm,
  identityFromProposal,
  validateIdentity,
} from "../../src/features/onboarding/components/IdentityForm";

describe("IdentityForm · identidade e contato obrigatórios", () => {
  it("pré-preenche a partir da proposta de identidade (inclusive telefone bruto BR)", () => {
    const v = identityFromProposal({
      fullName: "Isa Exemplo",
      email: "isa@example.com",
      phoneRaw: "+55 (11) 99999-9999",
      city: "São Paulo",
      country: "BR",
      links: [{ label: "GitHub", url: "https://github.com/x" }],
    });
    expect(v.fullName).toBe("Isa Exemplo");
    expect(v.displayName).toBe("Isa");
    expect(v.phone).toEqual({ country: "BR", area: "11", number: "999999999" });
    expect(v.city).toBe("São Paulo");
    expect(v.links).toHaveLength(1);
  });

  it("valida obrigatórios: telefone, cidade, país, relocação e situação de trabalho", () => {
    const base = identityFromProposal({});
    const errors = validateIdentity({ ...base, email: "x" });
    expect(Object.keys(errors)).toEqual(
      expect.arrayContaining(["fullName", "email", "phone", "city"]),
    );
    const ok = validateIdentity({
      ...base,
      displayName: "Isa",
      fullName: "Isa Exemplo",
      email: "isa@example.com",
      phone: { country: "BR", area: "11", number: "999999999" },
      city: "São Paulo",
      country: "BR",
      timezone: "America/Sao_Paulo",
      workAuth: [{ country: "BR", status: "citizen" }],
    });
    expect(ok).toEqual({});
  });

  it("mostra erros nos campos ao tentar enviar incompleto e marca o que não estava no CV", async () => {
    const onSubmit = vi.fn();
    render(
      <IdentityForm
        initial={identityFromProposal({ fullName: "Isa Exemplo" })}
        onSubmit={onSubmit}
        submitLabel="Avançar"
      />,
    );
    expect(screen.getAllByText("não estava no currículo").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Avançar" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Preencha os campos obrigatórios para avançar.")).toBeInTheDocument();
  });
});
