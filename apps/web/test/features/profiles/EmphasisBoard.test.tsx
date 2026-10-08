import type { EmphasisPutRequest } from "@narnia-jobs/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EmphasisBoard } from "../../../src/features/profiles/EmphasisBoard";
import type { ApiClient } from "../../../src/lib/api";
import { renderWithProviders } from "../../helpers";

const card = {
  profileId: "p1",
  text: "Ana · Campinas\nResumo objetivo: 13 anos",
  tokensEst: 12,
  hash: "h1",
  factsVersion: 1,
  builtAt: "2026-10-08T15:00:00.000Z",
  valid: true,
};

function setup() {
  const fakes = {
    getEmphasis: vi.fn(async () => ({
      items: [
        {
          kind: "experience" as const,
          id: "e1",
          mode: "highlight" as const,
          position: 0,
          label: "Engenheira Sênior",
          sublabel: "Acme",
          date: "2026-01-01",
          relevance: { score: 0.9, reasons: ["recente", "destacada"] },
        },
        {
          kind: "experience" as const,
          id: "e2",
          mode: "normal" as const,
          position: 1,
          label: "Dev Pleno",
          sublabel: "Beta",
          date: "2020-01-01",
          relevance: { score: 0.5, reasons: ["antiga"] },
        },
        {
          kind: "skill" as const,
          id: "s1",
          mode: "hidden" as const,
          position: null,
          label: "PHP",
          sublabel: "language",
          date: null,
          relevance: null,
        },
      ],
    })),
    putEmphasis: vi.fn(async (_id: string, _body: EmphasisPutRequest) => ({ updated: 3 })),
    getProfileCard: vi.fn(async () => card),
  };
  const utils = renderWithProviders(<EmphasisBoard profileId="p1" />, {
    api: fakes as Partial<ApiClient>,
  });
  return { ...utils, fakes };
}

describe("EmphasisBoard · modos, ordem por botões, salvar em lote e prévia (F02 §4)", () => {
  it("lista por tipo com relevância; aba de projetos vazia explica; skill oculta aparece como oculta", async () => {
    setup();
    const list = await screen.findByRole("list", { name: "Experiências" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Engenheira Sênior");
    expect(items[0]).toHaveTextContent("Relevância 90%");
    expect(
      within(items[0] as HTMLElement).getByRole("combobox", {
        name: "Ênfase de Engenheira Sênior",
      }),
    ).toHaveValue("highlight");
    await userEvent.click(screen.getByRole("tab", { name: "Projetos" }));
    expect(await screen.findByText(/Projetos chegam com a ingestão do GitHub/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Skills" }));
    expect(await screen.findByRole("combobox", { name: "Ênfase de PHP" })).toHaveValue("hidden");
  });

  it("descer o primeiro, mudar o modo e salvar envia o lote; a prévia do cartão recarrega", async () => {
    const { fakes } = setup();
    const list = await screen.findByRole("list", { name: "Experiências" });
    await waitFor(() => expect(fakes.getProfileCard).toHaveBeenCalledTimes(1));
    const first = within(list).getAllByRole("listitem")[0] as HTMLElement;
    await userEvent.click(within(first).getByRole("button", { name: "Descer" }));
    const reordered = within(list).getAllByRole("listitem");
    expect(reordered[0]).toHaveTextContent("Dev Pleno");
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
    await userEvent.selectOptions(
      within(reordered[0] as HTMLElement).getByRole("combobox", { name: "Ênfase de Dev Pleno" }),
      "hidden",
    );
    await userEvent.click(screen.getByRole("button", { name: "Salvar ênfases" }));
    await waitFor(() => expect(fakes.putEmphasis).toHaveBeenCalledTimes(1));
    expect(fakes.putEmphasis.mock.calls[0]?.[1]).toEqual({
      items: [
        { kind: "experience", id: "e2", mode: "hidden", position: 0 },
        { kind: "experience", id: "e1", mode: "highlight", position: 1 },
        { kind: "skill", id: "s1", mode: "hidden", position: 0 },
      ],
    });
    expect(await screen.findByText("Ênfases salvas.")).toBeInTheDocument();
    await waitFor(() => expect(fakes.getProfileCard).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/Resumo objetivo: 13 anos/)).toBeInTheDocument();
  });
});
