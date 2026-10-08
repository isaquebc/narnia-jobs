import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dashboard } from "../../src/features/dashboard/Dashboard";
import { renderWithProviders } from "../helpers";

const profile = {
  id: "p1",
  userId: "u1",
  name: "Eng. de Software Sênior",
  targetTitle: "Senior Backend Engineer",
  altTitles: [],
  seniority: "senior" as const,
  area: "software",
  goal: "new_job" as const,
  market: "BR",
  docLocale: "pt-BR",
  salaryBelowReference: false,
  contractTypes: ["clt" as const],
  locations: [],
  availableFrom: "immediate" as const,
  needsResearch: ["salary" as const],
  isActive: true,
  cardUpdatedAt: "2026-10-07T15:00:00.000Z",
};

describe("Dashboard · cartão, contadores, uso e pendências", () => {
  it("mostra dados do perfil, contadores, tokens, pendências e datas no fuso do usuário", async () => {
    renderWithProviders(<Dashboard />, {
      api: {
        getDashboard: async () => ({
          profile,
          counts: { experiences: 2, skills: 6, education: 1, files: 1, projects: 0 },
          usage: { totalTokens: 6710, byCategory: { ingest: 6710 } },
          pendingResearch: 1,
          card: null,
          emphasis: { highlighted: 0, hidden: 0 },
          suggestions: 0,
        }),
        getUser: async () => ({
          user: {
            id: "u1",
            displayName: "Isa",
            fullName: "Isa Exemplo",
            email: "isa@example.com",
            phone: { e164: "+5511999999999", country: "BR", national: "11999999999" },
            city: "São Paulo",
            country: "BR",
            timezone: "America/Sao_Paulo",
            remotePref: "remote",
            relocation: { mode: "none", countries: [] },
            workAuth: [{ country: "BR", status: "citizen" }],
            links: [],
            createdAt: "2026-10-07T15:00:00.000Z",
            updatedAt: "2026-10-07T15:00:00.000Z",
          },
        }),
      },
      timezone: "America/Sao_Paulo",
    });
    expect(await screen.findByText("Olá, Isa")).toBeInTheDocument();
    expect(screen.getByText("Senior Backend Engineer")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("6.7k tokens até agora")).toBeInTheDocument();
    expect(screen.getByText("1 itens para resolver com o recrutador")).toBeInTheDocument();
    expect(screen.getByText("Atualizado em 07/10/2026 12:00")).toBeInTheDocument();
  });

  it("sem cartão do perfil ainda (F01), a data mostrada é a última atualização do perfil, no fuso do usuário", async () => {
    renderWithProviders(<Dashboard />, {
      api: {
        getDashboard: async () => ({
          profile: {
            ...profile,
            cardUpdatedAt: null,
            // a API devolve created/updatedAt do registro; o schema do shared não os declara (campos extras)
            updatedAt: "2026-10-07T03:30:00.000Z",
          } as unknown as typeof profile,
          counts: { experiences: 0, skills: 0, education: 0, files: 0, projects: 0 },
          usage: { totalTokens: 0, byCategory: {} },
          pendingResearch: 0,
          card: null,
          emphasis: { highlighted: 0, hidden: 0 },
          suggestions: 0,
        }),
        getUser: async () => ({ user: null }),
      },
      timezone: "America/Sao_Paulo",
    });
    expect(await screen.findByText("Atualizado em 07/10/2026 00:30")).toBeInTheDocument();
  });

  it("estado vazio aponta para o primeiro uso", async () => {
    renderWithProviders(<Dashboard />, {
      api: {
        getDashboard: async () => ({
          profile: null,
          counts: { experiences: 0, skills: 0, education: 0, files: 0, projects: 0 },
          usage: { totalTokens: 0, byCategory: {} },
          pendingResearch: 0,
          card: null,
          emphasis: { highlighted: 0, hidden: 0 },
          suggestions: 0,
        }),
        getUser: async () => ({ user: null }),
      },
    });
    expect(
      await screen.findByText("Nenhum dado ainda. Comece pelo primeiro uso."),
    ).toBeInTheDocument();
  });
});
