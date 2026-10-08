import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProposalList } from "../../src/features/onboarding/components/ProposalList";

const proposals = [
  {
    id: "p1",
    decision: "pending" as const,
    origin: "text_layer" as const,
    proposal: {
      kind: "experience" as const,
      confidence: 0.9,
      data: {
        company: "Acme",
        title: "Engenheira",
        startDate: "2021-01",
        isCurrent: false,
        tech: ["Go"],
      },
    },
  },
  {
    id: "p2",
    decision: "pending" as const,
    origin: "ocr" as const,
    proposal: {
      kind: "skill" as const,
      confidence: 0.6,
      data: { name: "Docker", category: "infra" as const },
    },
  },
  {
    id: "p3",
    decision: "pending" as const,
    origin: null,
    proposal: {
      kind: "skill" as const,
      confidence: 0.5,
      data: { name: "Kafka", category: "infra" as const },
    },
  },
];

describe("ProposalList · aceitar/editar/rejeitar", () => {
  it("agrupa por tipo, conta pendentes e decide individualmente", async () => {
    const onDecide = vi.fn();
    const { rerender } = render(
      <ProposalList proposals={proposals} decisions={{}} onDecide={onDecide} />,
    );
    expect(screen.getByText("3 pendentes")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Experiências" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument();
    expect(screen.getByText("confiança 90%")).toBeInTheDocument();
    const row = screen.getByTestId("proposal-p2");
    await userEvent.click(within(row).getByRole("button", { name: "Rejeitar" }));
    expect(onDecide).toHaveBeenCalledWith("p2", "rejected", undefined);
    rerender(
      <ProposalList
        proposals={proposals}
        decisions={{ p2: { decision: "rejected" } }}
        onDecide={onDecide}
      />,
    );
    expect(screen.getByText("2 pendentes")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("proposal-p2")).getByRole("button", { name: "Desfazer" }),
    ).toBeInTheDocument();
  });

  it("ações em lote aceitam tudo que está pendente", async () => {
    const onDecide = vi.fn();
    render(
      <ProposalList
        proposals={proposals}
        decisions={{ p1: { decision: "accepted" } }}
        onDecide={onDecide}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Aceitar todos" }));
    expect(onDecide).toHaveBeenCalledTimes(2);
    expect(onDecide).toHaveBeenCalledWith("p2", "accepted", undefined);
    expect(onDecide).toHaveBeenCalledWith("p3", "accepted", undefined);
  });

  it("editar abre diálogo, salva com os dados editados e mostra badge 'editado'", async () => {
    const onDecide = vi.fn();
    const { rerender } = render(
      <ProposalList proposals={proposals} decisions={{}} onDecide={onDecide} />,
    );
    await userEvent.click(
      within(screen.getByTestId("proposal-p1")).getByRole("button", { name: "Editar" }),
    );
    const dialog = await screen.findByRole("dialog");
    const title = within(dialog).getByLabelText("title");
    await userEvent.clear(title);
    await userEvent.type(title, "Engenheira Sênior");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar edição" }));
    expect(onDecide).toHaveBeenCalledWith(
      "p1",
      "edited",
      expect.objectContaining({ title: "Engenheira Sênior" }),
    );
    rerender(
      <ProposalList
        proposals={proposals}
        decisions={{ p1: { decision: "edited", editedData: { title: "Engenheira Sênior" } } }}
        onDecide={onDecide}
      />,
    );
    expect(within(screen.getByTestId("proposal-p1")).getByText("editado")).toBeInTheDocument();
  });
});
