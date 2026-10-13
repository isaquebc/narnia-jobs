import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "../router-helpers";
import { githubAuth } from "./fixtures";
import { shellApi } from "./shell-api";

/** Evidências › Arquivos e textos: CVs e textos ingeridos com o registro de contexto (relato do dono, 2026-10-13). */
function api(overrides: Record<string, unknown> = {}) {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    getGithubAuth: async () => githubAuth(),
    listRepos: async () => ({ repos: [] }),
    ...overrides,
  };
}

const file = (over: Record<string, unknown> = {}) => ({
  id: "f1",
  kind: "text",
  originalName: null,
  mime: "text/plain",
  size: 640,
  pages: null,
  uploadedAt: "2026-10-13T12:00:00.000Z",
  digest: {
    fileId: "f1",
    summary: "Relato da experiência na Acme com salário e contrato.",
    keyPoints: ["Acme (2022–atual, PJ)"],
    sections: [],
    meta: { language: "pt-BR" },
    editedByUser: false,
  },
  runs: [
    { runId: "r2", status: "review", createdAt: "2026-10-13T12:01:00.000Z" },
    { runId: "r1", status: "done", createdAt: "2026-10-13T12:00:30.000Z" },
  ],
  facts: { total: 3, accepted: 1, rejected: 1, pending: 1 },
  ...over,
});

describe("Evidências › Arquivos e textos", () => {
  it("lista textos e currículos com resumo, fatos gerados, última execução e o texto lido sob demanda", async () => {
    const getFileText = vi.fn(async () => ({ text: "Na Acme, de 2022 até hoje, PJ 30 h/semana." }));
    renderApp({
      api: api({
        listFiles: async () => ({
          files: [
            file(),
            file({
              id: "f2",
              kind: "cv",
              originalName: "cv_2025.pdf",
              pages: 2,
              digest: null,
              runs: [],
              facts: { total: 0, accepted: 0, rejected: 0, pending: 0 },
            }),
          ],
        }),
        getFileText,
      }),
      initialUrl: "/evidencias/arquivos",
    });
    expect(
      await screen.findByRole("heading", { name: "Evidências › Arquivos e textos" }),
    ).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Arquivos e textos ingeridos" });
    const txt = within(list).getByRole("listitem", { name: "Texto livre" });
    expect(
      within(txt).getByText("Relato da experiência na Acme com salário e contrato."),
    ).toBeInTheDocument();
    expect(within(txt).getByText("Acme (2022–atual, PJ)")).toBeInTheDocument();
    expect(
      within(txt).getByText("Fatos gerados: 3 (1 aceitos, 1 rejeitados, 1 pendentes)"),
    ).toBeInTheDocument();
    expect(within(txt).getByRole("link", { name: "Ver execução" })).toHaveAttribute(
      "href",
      "/ingestao/r2",
    );
    await userEvent.click(within(txt).getByRole("button", { name: "Ver texto" }));
    expect(
      await within(txt).findByText("Na Acme, de 2022 até hoje, PJ 30 h/semana."),
    ).toBeInTheDocument();
    expect(getFileText).toHaveBeenCalledWith("f1");
    const cv = within(list).getByRole("listitem", { name: "cv_2025.pdf" });
    expect(within(cv).getByText("Currículo · 2 págs")).toBeInTheDocument();
    expect(within(cv).getByText("Ainda sem registro de contexto.")).toBeInTheDocument();
    expect(within(cv).queryByRole("link", { name: "Ver execução" })).toBeNull();
  });

  it("estado vazio aponta para a ingestão; abas ligam arquivos e repositórios", async () => {
    renderApp({
      api: api({ listFiles: async () => ({ files: [] }) }),
      initialUrl: "/evidencias/arquivos",
    });
    expect(
      await screen.findByText("Nenhum currículo ou texto ingerido ainda."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enviar currículo ou texto" })).toHaveAttribute(
      "href",
      "/ingestao",
    );
    const tabs = screen.getByRole("navigation", { name: "Seções de evidências" });
    expect(within(tabs).getByRole("link", { name: "Repositórios" })).toHaveAttribute(
      "href",
      "/evidencias/repositorios",
    );
    expect(within(tabs).getByRole("link", { name: "Arquivos e textos" })).toHaveAttribute(
      "href",
      "/evidencias/arquivos",
    );
  });

  it("o menu lateral leva Evidências para arquivos e textos", async () => {
    renderApp({
      api: api({ listFiles: async () => ({ files: [] }) }),
      initialUrl: "/evidencias/repositorios",
    });
    const tabs = await screen.findByRole("navigation", { name: "Seções de evidências" });
    expect(within(tabs).getByRole("link", { name: "Arquivos e textos" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Evidências" })).toHaveAttribute(
      "href",
      "/evidencias/arquivos",
    );
  });
});

describe("cliente de API", () => {
  it("listFiles e getFileText", async () => {
    const { createApiClient } = await import("../../src/lib/api");
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return Response.json({ files: [] });
    }) as unknown as typeof globalThis.fetch;
    const c = createApiClient({ fetch });
    await c.listFiles();
    await c.getFileText("a b");
    expect(urls).toEqual(["/api/files", "/api/files/a%20b/text"]);
  });
});
