import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { githubAuth, ingestSettings } from "../f03/fixtures";
import { shellApi } from "../f03/shell-api";
import { renderApp } from "../router-helpers";

/**
 * Termos aprendidos pela busca (F04-fix-fundamentacao, FF-1): o recrutador liga um termo que a busca não achava a um
 * fato que existe; a pessoa vê a lista em Configurações › Chat e apaga o que não quer.
 */
describe("Configurações › termos aprendidos pela busca", () => {
  it("lista termo → fato e apaga", async () => {
    const api = {
      ...shellApi,
      listNotifications: async () => ({ notifications: [], unresolved: 0 }),
      getIngestSettings: async () => ingestSettings(),
      getGithubAuth: async () => githubAuth(),
      listSnapshots: async () => ({ snapshots: [], totalBytes: 0, maxBytes: 2 * 1024 ** 3 }),
      getBackupSettings: async () => ({ max: 5, enabled: false, latest: null, count: 0 }),
      listFactAliases: vi.fn(async () => ({
        aliases: [
          {
            id: "a1",
            term: "orquestração",
            kind: "skill",
            factId: "s1",
            factLabel: "Kubernetes",
            sessionId: null,
            createdAt: "2026-10-29T12:00:00.000Z",
          },
        ],
      })),
      deleteFactAlias: vi.fn(async () => undefined),
    };
    renderApp({ api: api as never, initialUrl: "/configuracoes" });
    const list = await screen.findByRole("list", { name: "Termos aprendidos pela busca" });
    expect(within(list).getByText("orquestração")).toBeInTheDocument();
    expect(within(list).getByText(/Kubernetes/)).toBeInTheDocument();
    await userEvent.click(
      within(list).getByRole("button", { name: "Apagar o termo orquestração" }),
    );
    await waitFor(() => expect(api.deleteFactAlias).toHaveBeenCalledWith("a1"));
  });
});
