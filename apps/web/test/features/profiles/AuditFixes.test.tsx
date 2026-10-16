import type { EmphasisPutRequest, PersonaOverrides as Overrides } from "@narnia-jobs/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { FormGuardProvider, useFormGuard } from "../../../src/app/FormGuard";
import { EmphasisBoard } from "../../../src/features/profiles/EmphasisBoard";
import { PersonaOverrides } from "../../../src/features/profiles/PersonaOverrides";
import { PitchEditor } from "../../../src/features/profiles/PitchEditor";
import type { ApiClient } from "../../../src/lib/api";
import { profile } from "../../components/profile-fixture";
import { renderWithProviders } from "../../helpers";

function Probe() {
  const g = useFormGuard();
  return <span data-testid="dirty">{String(g.dirty)}</span>;
}

/** Host que permite desmontar o formulário sem desmontar o provider (simula sair da página pelo menu). */
function Host({ children }: { children: ReactNode }) {
  const [show, setShow] = useState(true);
  return (
    <FormGuardProvider confirm={() => false}>
      <Probe />
      <button type="button" onClick={() => setShow(false)}>
        Fechar formulário
      </button>
      {show ? children : null}
    </FormGuardProvider>
  );
}

const card = {
  profileId: "p1",
  text: "Ana · Campinas\nResumo: 13 anos",
  tokensEst: 12,
  hash: "h1",
  factsVersion: 1,
  builtAt: "2026-10-08T15:00:00.000Z",
  valid: true,
};
const emphasisFakes = (cardValid: boolean) => ({
  getEmphasis: vi.fn(async () => ({
    cardValid,
    items: [
      {
        kind: "experience" as const,
        id: "e1",
        mode: "highlight" as const,
        position: 0,
        label: "Engenheira Sênior",
        sublabel: "Acme",
        date: "2026-01",
        relevance: { score: 0.9, reasons: ["recente"] },
      },
      {
        kind: "experience" as const,
        id: "e2",
        mode: "normal" as const,
        position: 1,
        label: "Dev Pleno",
        sublabel: "Beta",
        date: "2020-01",
        relevance: { score: 0.5, reasons: [] },
      },
    ],
  })),
  putEmphasis: vi.fn(async (_id: string, _body: EmphasisPutRequest) => ({ updated: 2 })),
  getProfileCard: vi.fn(async () => card),
});
const persona = {
  specialty: "software · Senior Engineer",
  targetLevel: "senior" as const,
  market: "BR",
  language: "pt-BR",
  tone: "direto" as const,
  honesty: "maxima" as const,
  rigor: "alto" as const,
  recruiterSeniority: "senior" as const,
};

describe("Auditoria F02 (2026-10-08) · web", () => {
  it("11. PitchEditor sujo limpa o guard ao desmontar", async () => {
    renderWithProviders(
      <Host>
        <PitchEditor profile={profile("p1", { pitch: "" })} />
      </Host>,
      { api: { patchProfile: vi.fn() } as Partial<ApiClient> },
    );
    await userEvent.type(screen.getByRole("textbox", { name: "Pitch" }), "x");
    expect(screen.getByTestId("dirty")).toHaveTextContent("true");
    await userEvent.click(screen.getByRole("button", { name: "Fechar formulário" }));
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
  });

  it("11. EmphasisBoard sujo limpa o guard ao desmontar", async () => {
    renderWithProviders(
      <Host>
        <EmphasisBoard profileId="p1" />
      </Host>,
      { api: emphasisFakes(true) as Partial<ApiClient> },
    );
    const list = await screen.findByRole("list", { name: "Experiências" });
    const first = within(list).getAllByRole("listitem")[0] as HTMLElement;
    await userEvent.click(within(first).getByRole("button", { name: "Descer" }));
    expect(screen.getByTestId("dirty")).toHaveTextContent("true");
    await userEvent.click(screen.getByRole("button", { name: "Fechar formulário" }));
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
  });

  it("12. PersonaOverrides marca sujo ao mudar um seletor e limpa ao salvar; desmontar também limpa", async () => {
    const putPersona = vi.fn(async (_id: string, overrides: Overrides) => ({
      persona: { ...persona, ...overrides },
      defaults: persona,
      overrides,
    }));
    renderWithProviders(
      <Host>
        <PersonaOverrides profileId="p1" />
      </Host>,
      {
        api: {
          getPersona: vi.fn(async () => ({ persona, defaults: persona, overrides: {} })),
          putPersona,
        } as Partial<ApiClient>,
      },
    );
    const tone = await screen.findByRole("combobox", { name: "Tom" });
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
    await userEvent.selectOptions(tone, "cordial");
    expect(screen.getByTestId("dirty")).toHaveTextContent("true");
    await userEvent.click(screen.getByRole("button", { name: "Salvar persona" }));
    await waitFor(() => expect(putPersona).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("dirty")).toHaveTextContent("false"));
    await userEvent.selectOptions(tone, "direto");
    expect(screen.getByTestId("dirty")).toHaveTextContent("true");
    await userEvent.click(screen.getByRole("button", { name: "Fechar formulário" }));
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
  });

  it("14. EmphasisBoard avisa que a relevância pode estar desatualizada quando o cartão está inválido; salvar envia kinds", async () => {
    const fakes = emphasisFakes(false);
    renderWithProviders(<EmphasisBoard profileId="p1" />, { api: fakes as Partial<ApiClient> });
    const list = await screen.findByRole("list", { name: "Experiências" });
    expect(screen.getByText(/relevância pode estar desatualizada/i)).toBeInTheDocument();
    const first = within(list).getAllByRole("listitem")[0] as HTMLElement;
    await userEvent.click(within(first).getByRole("button", { name: "Descer" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar ênfases" }));
    await waitFor(() => expect(fakes.putEmphasis).toHaveBeenCalledTimes(1));
    expect(fakes.putEmphasis.mock.calls[0]?.[1]?.kinds).toEqual([
      "experience",
      "achievement",
      "project",
      "skill",
      "education",
      "language",
    ]);
  });
});
