import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "../router-helpers";
import { githubAuth, proposal, run } from "./fixtures";
import { shellApi } from "./shell-api";

/** A revisão mostra por que um item ficou "Sem suporte" ou "Parcial" (pedido do dono, 2026-10-13). */
const skill = (name: string) => ({
  kind: "skill",
  confidence: 0.8,
  data: { name, category: "language" },
});

describe("motivo do selo na revisão", () => {
  it("mostra o motivo da camada 1, a nota do revisor e infere 'sem trecho' em execuções antigas", async () => {
    renderApp({
      api: {
        ...shellApi,
        listNotifications: async () => ({ notifications: [], unresolved: 0 }),
        getGithubAuth: async () => githubAuth(),
        getIngestion: async () =>
          run({
            status: "review",
            proposals: [
              proposal("p1", {
                proposal: skill("Go"),
                checkStatus: "unsupported",
                checkReason: { layer: 1, code: "quote_not_found" },
              }),
              proposal("p2", {
                proposal: skill("Rust"),
                checkStatus: "partial",
                checkReason: { layer: 2, code: "reviewer", note: "O trecho não cita o nível." },
              }),
              proposal("p3", {
                proposal: skill("Zig"),
                checkStatus: "unsupported",
                evidence: null,
              }),
              proposal("p4", { proposal: skill("Java"), checkStatus: "supported" }),
            ],
          }),
      },
      initialUrl: "/ingestao/r1",
    });
    const go = await screen.findByRole("listitem", { name: "Go" });
    expect(
      within(go).getByText("Motivo: o trecho citado não foi encontrado no texto lido."),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("listitem", { name: "Rust" })).getByText(
        "Motivo (revisor): O trecho não cita o nível.",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("listitem", { name: "Zig" })).getByText(
        "Motivo: o modelo não indicou o trecho de onde tirou este item.",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("listitem", { name: "Java" })).queryByText(/^Motivo/),
    ).toBeNull();
  });
});
