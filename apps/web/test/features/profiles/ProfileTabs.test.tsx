import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MotivationsSection } from "../../../src/features/profiles/MotivationsEditor";
import { PersonaOverrides } from "../../../src/features/profiles/PersonaOverrides";
import { PitchEditor } from "../../../src/features/profiles/PitchEditor";
import { ProfileCardView } from "../../../src/features/profiles/ProfileCardView";
import type { ApiClient } from "../../../src/lib/api";
import { profile } from "../../components/profile-fixture";
import { renderWithProviders } from "../../helpers";

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

describe("PitchEditor · narrativa (F02 §4)", () => {
  it("mostra contador e salva pelo PATCH", async () => {
    const patchProfile = vi.fn(async (id: string, body: { pitch?: string | null }) =>
      profile(id, { pitch: body.pitch ?? null }),
    );
    renderWithProviders(<PitchEditor profile={profile("p1", { pitch: "Olá" })} />, {
      api: { patchProfile } as Partial<ApiClient>,
    });
    const box = await screen.findByRole("textbox", { name: "Pitch" });
    expect(box).toHaveValue("Olá");
    await userEvent.clear(box);
    await userEvent.type(box, "Linha 1{Enter}Linha 2");
    expect(screen.getByText("15 caracteres · 2 linhas")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Salvar narrativa" }));
    await waitFor(() =>
      expect(patchProfile).toHaveBeenCalledWith("p1", { pitch: "Linha 1\nLinha 2" }),
    );
    expect(await screen.findByText("Narrativa salva.")).toBeInTheDocument();
  });
});

describe("MotivationsSection · o que te move (F12-23)", () => {
  it("na narrativa: as aceitas e as sugestões, pedir mais sugestões e o tratamento", async () => {
    const suggestMotivations = vi.fn(async () => ({ job: null }));
    renderWithProviders(<MotivationsSection profileId="p1" />, {
      api: {
        listMotivations: async () => ({
          items: [
            {
              id: "m1",
              profileId: "p1",
              text: "Quero continuar trabalhando com pagamentos.",
              status: "accepted",
              source: "model",
              assumption: null,
              createdAt: "t",
              updatedAt: "t",
            },
          ],
          reviewed: true,
          suggesting: false,
        }),
        suggestMotivations,
        getUser: async () => ({ user: { pronouns: "masculino" } }) as never,
      } as Partial<ApiClient>,
    });
    expect(await screen.findByRole("heading", { name: "O que te move" })).toBeInTheDocument();
    expect(
      await screen.findByText("Quero continuar trabalhando com pagamentos."),
    ).toBeInTheDocument();
    expect(screen.getByText("Aceita")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Como o narnia se refere a você" })).toHaveValue(
        "masculino",
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Sugerir mais" }));
    expect(suggestMotivations).toHaveBeenCalledWith("p1");
  });
});

describe("PersonaOverrides · seletores com padrão e restaurar (F02-7)", () => {
  it("mostra a persona em uso, salva um override e restaura com null", async () => {
    const putPersona = vi.fn(async (_id: string, overrides: Record<string, unknown>) => ({
      persona: {
        ...persona,
        tone: overrides.tone === "cordial" ? ("cordial" as const) : persona.tone,
      },
      defaults: persona,
      overrides: overrides.tone === null ? {} : overrides,
    }));
    renderWithProviders(<PersonaOverrides profileId="p1" />, {
      api: {
        getPersona: async () => ({ persona, defaults: persona, overrides: {} }),
        putPersona,
      } as Partial<ApiClient>,
    });
    const tone = await screen.findByRole("combobox", { name: "Tom" });
    expect(tone).toHaveValue("direto");
    expect(screen.getByRole("combobox", { name: "Honestidade" })).toHaveValue("maxima");
    expect(screen.getByRole("combobox", { name: "Senioridade do recrutador" })).toHaveValue(
      "senior",
    );
    await userEvent.selectOptions(tone, "cordial");
    await userEvent.click(screen.getByRole("button", { name: "Salvar persona" }));
    await waitFor(() => expect(putPersona).toHaveBeenCalledWith("p1", { tone: "cordial" }));
    expect(await screen.findByText("Persona salva.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restaurar padrão Tom" }));
    await waitFor(() => expect(putPersona).toHaveBeenLastCalledWith("p1", { tone: null }));
  });
});

describe("ProfileCardView · cartão com estado e botão de atualizar (F02-1)", () => {
  it("mostra texto, tokens, data no fuso, aviso de desatualizado e reconstrói", async () => {
    const stale = {
      profileId: "p1",
      text: "Ana Maria · Campinas\nResumo objetivo: 13 anos de carreira\nAlvo: Senior Engineer",
      tokensEst: 20,
      hash: "h1",
      factsVersion: 1,
      builtAt: "2026-10-08T15:00:00.000Z",
      valid: false,
    };
    const rebuildProfileCard = vi.fn(async () => ({ ...stale, valid: true, hash: "h2" }));
    renderWithProviders(<ProfileCardView profileId="p1" />, {
      api: { getProfileCard: async () => stale, rebuildProfileCard } as Partial<ApiClient>,
      timezone: "America/Sao_Paulo",
    });
    expect(await screen.findByText(/Desatualizado/)).toBeInTheDocument();
    expect(screen.getByText("~20 tokens · 79 caracteres")).toBeInTheDocument();
    expect(screen.getByText("Atualizado em 08/10/2026 12:00")).toBeInTheDocument();
    expect(screen.getByText("Resumo objetivo: 13 anos de carreira")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Atualizar cartão" }));
    await waitFor(() => expect(rebuildProfileCard).toHaveBeenCalledWith("p1"));
    expect(await screen.findByText("Atualizado")).toBeInTheDocument();
  });
});
