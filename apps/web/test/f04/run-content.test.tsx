import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { planUsage, proposal, run } from "../f03/fixtures";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";

/**
 * Página da ingestão (pedido do dono, 2026-10-14): mostra o que está sendo ou foi ingerido em qualquer estado (antes,
 * ao terminar, nada dizia o que entrou) e, depois de salva, o que foi aceito e onde entrou.
 */
const TEXT = "Na Acme Pagamentos eu liderei 7 pessoas.\nConquista: criei o guia de onboarding.";

function api(r: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    getPlanUsage: async () => planUsage(),
    getIngestion: async () => run({ report: null, budget: null, repos: [], ...r }),
    getFileText: vi.fn(async () => ({ text: TEXT })),
    ...overrides,
  };
}

const ach = (id: string, text: string, decision: string, label: string) =>
  proposal(id, {
    proposal: { kind: "achievement", confidence: 0.8, data: { text } },
    decision,
    reference: { existing: null, experience: { source: "profile", label, experienceId: "e1" } },
  });

describe("página da ingestão: o que foi ingerido e o que foi salvo", () => {
  it("texto terminado: mostra o texto inteiro, a origem e o resultado com onde cada item entrou", async () => {
    renderApp({
      api: api({
        source: "text",
        fileId: "f1",
        status: "done",
        origin: { name: null, excerpt: "Na Acme…", chatTitle: "Liderança" },
        proposals: [
          ach("p1", "liderei 7 pessoas", "accepted", "Tech Lead · Acme · 2022-01–atual"),
          ach("p2", "criei o guia de onboarding", "rejected", "Tech Lead · Acme · 2022-01–atual"),
        ],
      }) as never,
      initialUrl: "/ingestao/r1",
    });
    const content = await screen.findByRole("region", { name: "O que foi ingerido" });
    expect(within(content).getByText("Origem:", { exact: false })).toBeInTheDocument();
    expect(within(content).getByText(/conversa “Liderança”/)).toBeInTheDocument();
    expect(await within(content).findByTestId("ingested-text")).toHaveTextContent(
      "Na Acme Pagamentos eu liderei 7 pessoas. Conquista: criei o guia de onboarding.",
    );
    const result = screen.getByRole("region", { name: "Resultado da revisão" });
    const lead = within(result).getByRole("listitem", { name: "liderei 7 pessoas" });
    expect(within(lead).getByText("Aceito")).toBeInTheDocument();
    expect(within(lead).getByTestId("entry-reference")).toHaveTextContent(
      "Entra em: Experiências › Tech Lead · Acme · 2022-01–atual › conquistas",
    );
    expect(
      within(
        within(result).getByRole("listitem", { name: "criei o guia de onboarding" }),
      ).getByText("Rejeitado"),
    ).toBeInTheDocument();
  });

  it("em andamento: 'O que está sendo ingerido', com o texto, e sem resultado ainda", async () => {
    renderApp({
      api: api({ source: "text", fileId: "f1", status: "running", proposals: [] }) as never,
      initialUrl: "/ingestao/r1",
    });
    const content = await screen.findByRole("region", { name: "O que está sendo ingerido" });
    expect(await within(content).findByTestId("ingested-text")).toHaveTextContent("liderei 7");
    expect(screen.queryByRole("region", { name: "Resultado da revisão" })).toBeNull();
  });

  it("currículo: nome do arquivo, registro de contexto e o texto lido sob demanda", async () => {
    const getFileText = vi.fn(async () => ({ text: "ANA MARIA EXEMPLO\nAcme Ltda" }));
    renderApp({
      api: api(
        {
          source: "cv",
          fileId: "f2",
          status: "done",
          origin: { name: "cv-2026.pdf", excerpt: null, chatTitle: null },
          digest: {
            fileId: "f2",
            summary: "Currículo de engenheira com 8 anos de backend.",
            keyPoints: ["Acme Ltda desde 2021"],
            sections: [],
            meta: {},
            editedByUser: false,
          },
          proposals: [],
        },
        { getFileText },
      ) as never,
      initialUrl: "/ingestao/r1",
    });
    const content = await screen.findByRole("region", { name: "O que foi ingerido" });
    expect(within(content).getByText(/Arquivo cv-2026\.pdf/)).toBeInTheDocument();
    expect(
      within(content).getByText("Currículo de engenheira com 8 anos de backend."),
    ).toBeInTheDocument();
    expect(within(content).getByText("Acme Ltda desde 2021")).toBeInTheDocument();
    expect(getFileText).not.toHaveBeenCalled();
    await userEvent.click(within(content).getByRole("button", { name: "Ver texto lido" }));
    expect(await within(content).findByTestId("ingested-text")).toHaveTextContent(
      "ANA MARIA EXEMPLO",
    );
  });
});
