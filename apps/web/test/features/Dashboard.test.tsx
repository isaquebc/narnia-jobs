import { screen, within } from "@testing-library/react";
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

describe("Dashboard · F02: resumo do cartão, ênfases e banner de sugestão", () => {
  it("mostra as 3 linhas do cartão com link, contadores de ênfase e o banner com aceitar/dispensar", async () => {
    const { api } = renderWithProviders(<Dashboard />, {
      api: {
        getDashboard: async () => ({
          profile,
          counts: { experiences: 2, skills: 6, education: 1, files: 1, projects: 0 },
          usage: { totalTokens: 0, byCategory: {} },
          pendingResearch: 0,
          card: {
            text: "Ana · Campinas\nResumo objetivo: 13 anos\nAlvo: Senior Backend Engineer",
            builtAt: "2026-10-07T15:00:00.000Z",
            valid: false,
          },
          emphasis: { highlighted: 3, hidden: 1 },
          suggestions: 1,
        }),
        getUser: async () => ({ user: null }),
        listSuggestions: async () => ({
          suggestions: [
            {
              id: "sg1",
              userId: "u1",
              source: "heuristic" as const,
              model: null,
              payload: {
                title: "Engineering Manager",
                seniority: "manager" as const,
                area: "engineering management",
                market: "BR",
                rationale: "3 anos liderando squads",
                supportingFactIds: ["e1"],
              },
              status: "new" as const,
              createdAt: "2026-10-08T12:00:00.000Z",
              decidedAt: null,
            },
          ],
        }),
        dismissSuggestion: async () => ({ ok: true as const }),
      },
      timezone: "America/Sao_Paulo",
    });
    expect(await screen.findByText("Resumo objetivo: 13 anos")).toBeInTheDocument();
    expect(screen.getByText("3 em destaque · 1 ocultos")).toBeInTheDocument();
    expect(screen.getByText("Cartão desatualizado")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver cartão completo" })).toHaveAttribute(
      "href",
      "/perfis/p1/cartao",
    );
    expect(
      await screen.findByText("Detectamos um possível perfil de Engineering Manager."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aceitar" })).toHaveAttribute(
      "href",
      expect.stringContaining("/perfis/novo?suggestionId=sg1"),
    );
    expect(screen.getByRole("button", { name: "Dispensar" })).toBeInTheDocument();
    expect(api).toBeTruthy();
  });

  it("uso por categoria, da mais cara para a mais barata, com chamadas, cache e custo (redução de custo, 2026-10-26)", async () => {
    renderWithProviders(<Dashboard />, {
      api: {
        getDashboard: async () => ({
          profile,
          counts: { experiences: 0, skills: 0, education: 0, files: 0, projects: 0 },
          usage: {
            totalTokens: 52000,
            byCategory: {},
            totalCostUsd: 1.25,
            categories: [
              {
                category: "chat.job",
                events: 4,
                tokens: 30000,
                cacheRead: 200000,
                cacheWrite: 9000,
                costUsd: 1,
              },
              {
                category: "chat.job.subagente",
                events: 4,
                tokens: 20000,
                cacheRead: 90000,
                cacheWrite: 0,
                costUsd: 0,
              },
              {
                category: "cv.generate",
                events: 2,
                tokens: 2000,
                cacheRead: 0,
                cacheWrite: 0,
                costUsd: 0.25,
              },
            ],
          },
          pendingResearch: 0,
          card: null,
          emphasis: { highlighted: 0, hidden: 0 },
          suggestions: 0,
        }),
        getUser: async () => ({ user: null }),
      },
      timezone: "America/Sao_Paulo",
    });
    const table = await screen.findByRole("table", { name: "Uso por categoria" });
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("chat.job");
    expect(rows[1]).toHaveTextContent("US$ 1,00");
    expect(rows[1]).toHaveTextContent("200k");
    expect(rows[2]).toHaveTextContent("chat.job.subagente");
    expect(rows[2]).toHaveTextContent("no custo da conversa");
    expect(screen.getByText(/US\$ 1,25 no total/)).toBeInTheDocument();
  });
});
