import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContractTypes } from "../../src/features/onboarding/components/ContractTypes";
import { LocationsInput } from "../../src/features/onboarding/components/LocationsInput";
import { SalaryRangeInput } from "../../src/features/onboarding/components/SalaryRangeInput";
import {
  isBelowReference,
  SalaryReferenceAlert,
} from "../../src/features/onboarding/components/SalaryReferenceAlert";

const ref = {
  id: "r1",
  country: "BR",
  source: "dieese" as const,
  indicator: "salario_minimo_necessario",
  value: 7300,
  currency: "BRL",
  period: "monthly" as const,
  referenceMonth: "2026-09",
  sourceUrl: "https://www.dieese.org.br/analisecestabasica/salarioMinimo.html",
  fetchedAt: "2026-10-07T00:00:00.000Z",
  isCurrent: true,
};

describe("SalaryReferenceAlert · piso DIEESE informativo", () => {
  it("compara só BRL mensal (anual ÷ 12); outras moedas não comparam", () => {
    expect(
      isBelowReference({ min: 6000, max: 9000, currency: "BRL", period: "monthly" }, ref),
    ).toBe(true);
    expect(
      isBelowReference({ min: 8000, max: 9000, currency: "BRL", period: "monthly" }, ref),
    ).toBe(false);
    expect(
      isBelowReference({ min: 60_000, max: 90_000, currency: "BRL", period: "yearly" }, ref),
    ).toBe(true);
    expect(
      isBelowReference({ min: 1000, max: 2000, currency: "USD", period: "monthly" }, ref),
    ).toBeNull();
  });
  it("aparece com valor, mês e fonte abaixo da referência; some em USD", () => {
    const { rerender } = render(
      <SalaryReferenceAlert
        salary={{ min: 6000, max: 9000, currency: "BRL", period: "monthly" }}
        reference={ref}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("09/2026");
    expect(alert).toHaveTextContent("7.300");
    expect(screen.getByRole("link", { name: "Fonte" })).toHaveAttribute("href", ref.sourceUrl);
    rerender(
      <SalaryReferenceAlert
        salary={{ min: 1000, max: 2000, currency: "USD", period: "monthly" }}
        reference={ref}
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("SalaryRangeInput · obrigatório com 'não sei'", () => {
  it("emite a faixa e 'não sei' desabilita os campos", async () => {
    const onChange = vi.fn();
    const onDontKnow = vi.fn();
    const { rerender } = render(
      <SalaryRangeInput
        value={undefined}
        dontKnow={false}
        onChange={onChange}
        onDontKnow={onDontKnow}
      />,
    );
    await userEvent.type(screen.getByLabelText("Mínimo"), "6000");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ min: 6000 }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Não sei" }));
    expect(onDontKnow).toHaveBeenCalledWith(true);
    rerender(
      <SalaryRangeInput value={undefined} dontKnow onChange={onChange} onDontKnow={onDontKnow} />,
    );
    expect(screen.getByLabelText("Mínimo")).toBeDisabled();
    expect(screen.getByText("Marcado para pesquisar com o recrutador")).toBeInTheDocument();
  });
  it("mostra erro quando mínimo > máximo", () => {
    render(
      <SalaryRangeInput
        value={{ min: 9000, max: 6000, currency: "BRL", period: "monthly" }}
        dontKnow={false}
        onChange={() => {}}
        onDontKnow={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("O mínimo não pode exceder o máximo.");
  });
});

describe("ContractTypes e LocationsInput", () => {
  it("contratos: alterna valores e 'não sei'", async () => {
    const onChange = vi.fn();
    render(
      <ContractTypes value={["clt"]} dontKnow={false} onChange={onChange} onDontKnow={() => {}} />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "PJ" }));
    expect(onChange).toHaveBeenCalledWith(["clt", "pj"]);
    await userEvent.click(screen.getByRole("checkbox", { name: "CLT" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
  it("localidades: adiciona e remove", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <LocationsInput value={[]} dontKnow={false} onChange={onChange} onDontKnow={() => {}} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Adicionar localidade" }));
    expect(onChange).toHaveBeenCalledWith([{ country: "BR", remote: "any" }]);
    rerender(
      <LocationsInput
        value={[{ country: "BR", city: "São Paulo", remote: "remote" }]}
        dontKnow={false}
        onChange={onChange}
        onDontKnow={() => {}}
      />,
    );
    expect(screen.getByDisplayValue("São Paulo")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remover" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
