import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { groupByCategory } from "../../src/components/shell/ChatNav";
import { shellApi } from "../f03/shell-api";
import { session } from "../f04/fixtures";
import { renderApp } from "../router-helpers";

/** F06/M1 · recrutador global (F06-8): conversas de todos os perfis, agrupadas por tema no menu. */
function api(sessions: ReturnType<typeof session>[]) {
  return {
    ...shellApi,
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    listIngestions: async () => ({ runs: [] }),
    listChatSessions: vi.fn(async () => ({ sessions })),
  };
}

describe("F06/M1 · menu de conversas agrupado", () => {
  it("groupByCategory mantém a ordem da conversa mais recente de cada tema", () => {
    const g = groupByCategory([
      session("a", { category: "job" }),
      session("b", { category: "career" }),
      session("c", { category: "job" }),
    ]);
    expect(g.map((x) => [x.category, x.sessions.map((s) => s.id)])).toEqual([
      ["job", ["a", "c"]],
      ["career", ["b"]],
    ]);
  });

  it("com mais de um tema, cada grupo tem o rótulo do tema; a lista não depende do perfil", async () => {
    const a = api([
      session("s1", { category: "job", title: "Nubank - Backend Engineer", profileId: null }),
      session("s2", { category: "career", title: "Carreira" }),
    ]);
    renderApp({ api: a as never, initialUrl: "/dashboard" });
    const nav = await screen.findByRole("list", { name: "Conversas do chat" });
    const vaga = await within(nav).findByRole("list", { name: "Vaga" });
    expect(
      within(vaga).getByRole("link", { name: /Nubank - Backend Engineer/ }),
    ).toBeInTheDocument();
    expect(within(nav).getByRole("list", { name: "Carreira" })).toBeInTheDocument();
    expect(a.listChatSessions).toHaveBeenCalledWith(null);
  });

  it("um tema só: lista simples, sem rótulo", async () => {
    renderApp({
      api: api([session("s1", { title: "Carreira" })]) as never,
      initialUrl: "/dashboard",
    });
    const nav = await screen.findByRole("list", { name: "Conversas do chat" });
    await within(nav).findByRole("link", { name: /Carreira/ });
    expect(within(nav).queryByRole("list", { name: "Carreira" })).toBeNull();
  });
});
