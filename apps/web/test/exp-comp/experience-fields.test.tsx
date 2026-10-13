import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { conflictValue } from "../../src/features/ingestion/ReviewPanel";
import {
  ProposalList,
  proposalSummary,
} from "../../src/features/onboarding/components/ProposalList";

/** Campos novos da experiência na web: resumo da proposta, edição e valores legíveis nos conflitos. */
const exp = (extra: Record<string, unknown> = {}) => ({
  kind: "experience" as const,
  confidence: 0.9,
  data: {
    company: "Acme",
    title: "Engenheira",
    startDate: "2021-01",
    isCurrent: true,
    tech: [],
    ...extra,
  },
});

describe("experiência: contrato, carga, salário e benefícios na web", () => {
  it("identidade nunca fica com resumo em branco (telefone, região, país e links contam)", () => {
    const id = (data: Record<string, unknown>) => ({
      kind: "identity" as const,
      confidence: 0.5,
      data,
    });
    expect(proposalSummary(id({ phoneRaw: "+55 81 99999-0000", country: "BR" }))).toBe(
      "+55 81 99999-0000 · BR",
    );
    expect(proposalSummary(id({ links: [{ label: "GitHub", url: "https://github.com/x" }] }))).toBe(
      "GitHub · https://github.com/x",
    );
    expect(proposalSummary(id({}))).toBe("Identidade sem dados");
  });

  it("o resumo da proposta mostra contrato, carga, salário com o equivalente mensal e benefícios", () => {
    expect(
      proposalSummary(
        exp({
          employmentType: "pj",
          weeklyHours: 30,
          compensation: { amount: 95, period: "hourly", currency: "BRL" },
          benefits: ["health_plan", "gym"],
          benefitsOther: ["auxílio creche"],
        }),
      ),
    ).toBe(
      "Engenheira · Acme · 2021-01– · PJ, 30 h/semana · R$ 95,00/hora (≈ R$ 12.350,00/mês com 30 h/semana) · Benefícios: Plano de saúde, Academia (Gympass/Wellhub), auxílio creche",
    );
    expect(proposalSummary(exp())).toBe("Engenheira · Acme · 2021-01–");
  });

  it("conflitos mostram valores legíveis e nomes em português; salário e benefícios não têm 'editar'", () => {
    expect(
      conflictValue("compensation", { amount: 12000, period: "monthly", currency: "BRL" }),
    ).toBe("R$ 12.000,00/mês");
    expect(conflictValue("benefits", ["health_plan", "gym"])).toBe(
      "Plano de saúde, Academia (Gympass/Wellhub)",
    );
    expect(conflictValue("employmentType", "clt")).toBe("CLT");
    expect(conflictValue("weeklyHours", 44)).toBe("44 h/semana");
    expect(conflictValue("weeklyHours", undefined)).toBe("—");
    expect(conflictValue("title", "Dev")).toBe("Dev");
  });

  it("edição no primeiro uso: contrato, carga, salário (valor, período, moeda) e benefícios", async () => {
    const onDecide = vi.fn();
    render(
      <ProposalList
        proposals={[{ id: "p1", decision: "pending", origin: null, proposal: exp() }]}
        decisions={{}}
        onDecide={onDecide}
      />,
    );
    await userEvent.click(
      within(screen.getByTestId("proposal-p1")).getByRole("button", { name: "Editar" }),
    );
    const dialog = screen.getByRole("dialog");
    await userEvent.selectOptions(within(dialog).getByLabelText("Tipo de contrato"), "pj");
    await userEvent.type(within(dialog).getByLabelText("Carga horária semanal (h)"), "30");
    await userEvent.type(within(dialog).getByLabelText("Salário (valor)"), "95");
    await userEvent.selectOptions(within(dialog).getByLabelText("Período do salário"), "hourly");
    await userEvent.clear(within(dialog).getByLabelText("Moeda"));
    await userEvent.type(within(dialog).getByLabelText("Moeda"), "brl");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Plano de saúde" }));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "13º salário" }));
    await userEvent.type(
      within(dialog).getByLabelText("Outros benefícios (separados por vírgula)"),
      "auxílio creche, bônus de indicação",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar edição" }));
    expect(onDecide).toHaveBeenCalledWith(
      "p1",
      "edited",
      expect.objectContaining({
        employmentType: "pj",
        weeklyHours: 30,
        compensation: { amount: 95, period: "hourly", currency: "BRL" },
        benefits: ["health_plan", "thirteenth_salary"],
        benefitsOther: ["auxílio creche", "bônus de indicação"],
      }),
    );
  });
});
