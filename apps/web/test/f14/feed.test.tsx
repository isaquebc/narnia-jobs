import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MailFeedSettings } from "../../src/features/settings/MailFeedSettings";
import { posting } from "../f06/fixtures";
import { renderWithProviders } from "../helpers";
import { renderApp } from "../router-helpers";

/**
 * F14/M4 · feed do e-mail na página de vagas (aba nova; a lista de sempre continua a primeira) com os selos: nova,
 * origem e plataforma, match e "link não abriu"; e as configurações do feed no cartão do Gmail.
 */
const mail = (id: string, over = {}) => ({
  ...posting(id, {
    source: "email",
    sourceRef: { gmailId: "g", platform: "linkedin", mailUrl: null, trusted: true },
    feedState: "new",
    matchScore: 82,
    linkStatus: "failed",
    ...over,
  }),
  application: null,
});

describe("F14/M4 · feed", () => {
  it("aba Feed do e-mail: só busca quando abre; selos de nova, origem, match e link que não abriu", async () => {
    const listFeed = vi.fn(async () => ({
      postings: [
        mail("p1", { company: "Acme" }),
        mail("p2", { company: "Globex", matchScore: 40, linkStatus: "ok", feedState: "seen" }),
      ],
    }));
    renderApp({
      api: { listPostings: async () => ({ postings: [] }), listFeed } as never,
      initialUrl: "/vagas",
    });
    expect(await screen.findByRole("tab", { name: "Todas", selected: true })).toBeInTheDocument();
    expect(listFeed).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("tab", { name: "Feed do e-mail" }));
    const list = await screen.findByRole("list", { name: "Feed do e-mail" });
    const acme = within(list).getByRole("listitem", { name: /Acme/ });
    expect(within(acme).getByText("Nova")).toBeInTheDocument();
    expect(within(acme).getByText("do e-mail · linkedin")).toBeInTheDocument();
    expect(within(acme).getByText("match 82")).toBeInTheDocument();
    expect(within(acme).getByText("link não abriu")).toBeInTheDocument();
    const globex = within(list).getByRole("listitem", { name: /Globex/ });
    expect(within(globex).queryByText("Nova")).toBeNull();
    expect(within(globex).queryByText("link não abriu")).toBeNull();
  });

  it("feed vazio: explica como conectar", async () => {
    renderApp({
      api: {
        listPostings: async () => ({ postings: [] }),
        listFeed: async () => ({ postings: [] }),
      } as never,
      initialUrl: "/vagas",
    });
    await userEvent.click(await screen.findByRole("tab", { name: "Feed do e-mail" }));
    expect(await screen.findByText(/Nenhuma vaga do e-mail ainda/)).toBeInTheDocument();
  });
});

describe("F14/M4 · configurações do feed", () => {
  it("mostra os padrões e salva os três valores", async () => {
    const putFeedSettings = vi.fn(async (p: object) => ({
      preanalysisCut: 70,
      preanalysisDailyCap: 10,
      linksPerRun: 100,
      ...p,
    }));
    renderWithProviders(<MailFeedSettings />, {
      api: {
        getFeedSettings: async () => ({
          preanalysisCut: 70,
          preanalysisDailyCap: 10,
          linksPerRun: 100,
        }),
        putFeedSettings,
      } as never,
    });
    const cut = await screen.findByLabelText("Pré-análise automática a partir do match");
    expect(cut).toHaveValue(70);
    await userEvent.clear(cut);
    await userEvent.type(cut, "80");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(putFeedSettings).toHaveBeenCalledWith({
        preanalysisCut: 80,
        preanalysisDailyCap: 10,
        linksPerRun: 100,
      }),
    );
  });
});
