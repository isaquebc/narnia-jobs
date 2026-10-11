import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "../router-helpers";
import { planUsage, repoDetail, report, run } from "./fixtures";
import { shellApi } from "./shell-api";

function api(overrides: Record<string, unknown> = {}) {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    getPlanUsage: async () => planUsage(),
    ...overrides,
  };
}

const failedRepoRun = (status: string) =>
  run({
    status,
    report: report({
      repos: [
        { fullName: "a/x", estimatedTokens: 4000, usedTokens: 4100, status: "done" },
        {
          fullName: "a/y",
          estimatedTokens: 4000,
          usedTokens: 200,
          status: "error",
          stoppedReason: "Reached maximum number of turns (1)",
        },
      ],
    }),
  });

describe("CM3 · ações que dizem o que fazem", () => {
  it("repositório que falhou ganha 'Tentar este repositório de novo' na própria linha, na mesma execução", async () => {
    const retryIngestionRepo = vi.fn(async () => ({ status: "running" }));
    renderApp({
      api: api({ getIngestion: async () => failedRepoRun("review"), retryIngestionRepo }),
      initialUrl: "/ingestao/r1",
    });
    const rows = await screen.findByRole("list", { name: "Repositórios da execução" });
    const failed = within(rows).getByText("a/y").closest("li") as HTMLElement;
    expect(
      within(within(rows).getByText("a/x").closest("li") as HTMLElement).queryByRole("button"),
    ).toBeNull();
    await userEvent.click(
      within(failed).getByRole("button", { name: "Tentar este repositório de novo" }),
    );
    expect(retryIngestionRepo).toHaveBeenCalledWith("r1", "a/y");
  });

  it("com a revisão salva o botão some (só Reanalisar)", async () => {
    renderApp({
      api: api({ getIngestion: async () => failedRepoRun("done") }),
      initialUrl: "/ingestao/r1",
    });
    await screen.findByRole("region", { name: "Relatório da execução" });
    expect(screen.queryByRole("button", { name: "Tentar este repositório de novo" })).toBeNull();
  });

  it("reanálise mostra a origem com link; a origem lista as reanálises", async () => {
    const { unmount } = renderApp({
      api: api({ getIngestion: async () => run({ id: "r2", parentRunId: "r1", childRunIds: [] }) }),
      initialUrl: "/ingestao/r2",
    });
    const origin = await screen.findByRole("link", { name: "Execução de origem" });
    expect(origin).toHaveAttribute("href", "/ingestao/r1");
    unmount();
    renderApp({
      api: api({
        getIngestion: async () => run({ id: "r1", parentRunId: null, childRunIds: ["r2", "r3"] }),
      }),
      initialUrl: "/ingestao/r1",
    });
    const links = await screen.findAllByRole("link", { name: /^Reanálise \d/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/ingestao/r2", "/ingestao/r3"]);
  });

  it("Reanalisar avisa que cria uma nova análise e não muda a execução anterior", async () => {
    renderApp({
      api: api({ getRepo: async () => repoDetail(), getPlanUsage: async () => ({ usage: null }) }),
      initialUrl: "/evidencias/repositorios/rp1",
    });
    await userEvent.click(await screen.findByRole("button", { name: "Reanalisar" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "Isto cria uma nova análise só deste repositório. A execução anterior não muda.",
      ),
    ).toBeInTheDocument();
  });
});
