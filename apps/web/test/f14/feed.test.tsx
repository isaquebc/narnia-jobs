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
    sourceRef: {
      gmailId: "g",
      platform: "linkedin",
      mailUrl: null,
      receivedAt: null,
      trusted: true,
    },
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

  it("card do feed (pedido do dono 2026-11-12): uma coluna, data do e-mail e da vaga salva, analisar, vaga oficial, e-mail e arquivar", async () => {
    const analyzePosting = vi.fn(async () => ({ session: { id: "s1" } }));
    const listFeed = vi.fn(async () => ({
      postings: [
        mail("p1", {
          company: "Acme",
          postingUrl: "https://www.linkedin.com/jobs/view/4012345678/",
          city: "São Paulo",
          state: "SP",
          workMode: "hybrid",
          jdText: "Buscamos uma pessoa desenvolvedora backend para o time de pagamentos.",
          sourceRef: {
            gmailId: "g1",
            platform: "linkedin",
            mailUrl: "https://mail.google.com/mail/u/0/#all/g1",
            receivedAt: "2026-11-10T13:05:00.000Z",
            trusted: true,
          },
        }),
        { ...mail("p2", { company: "Globex" }), analyzedAt: "2026-11-11T10:00:00.000Z" },
      ],
    }));
    renderApp({
      api: { listPostings: async () => ({ postings: [] }), listFeed, analyzePosting } as never,
      initialUrl: "/vagas",
    });
    await userEvent.click(await screen.findByRole("tab", { name: "Feed do e-mail" }));
    const list = await screen.findByRole("list", { name: "Feed do e-mail" });
    expect(list.className).not.toMatch(/grid-cols-2/);
    const acme = within(list).getByRole("listitem", { name: /Acme/ });
    expect(
      within(acme).getByText(/^E-mail recebido em 10\/11\/2026 .* · salva em/),
    ).toBeInTheDocument();
    expect(within(acme).getByText(/^São Paulo - SP · Híbrido/)).toBeInTheDocument();
    expect(within(acme).getByText(/time de pagamentos/)).toBeInTheDocument();
    expect(within(acme).getByRole("link", { name: "Ver vaga oficial" })).toHaveAttribute(
      "href",
      "https://www.linkedin.com/jobs/view/4012345678/",
    );
    expect(within(acme).getByRole("link", { name: "Ver o e-mail" })).toHaveAttribute(
      "href",
      "https://mail.google.com/mail/u/0/#all/g1",
    );
    expect(within(acme).getByRole("button", { name: "Arquivar vaga" })).toBeInTheDocument();
    // já analisada: "Ver análise" leva à vaga
    const globex = within(list).getByRole("listitem", { name: /Globex/ });
    expect(within(globex).getByRole("link", { name: "Ver análise" })).toHaveAttribute(
      "href",
      "/vagas/p2",
    );
    expect(within(globex).queryByRole("button", { name: "Analisar" })).toBeNull();
    // analisar abre a conversa da análise
    await userEvent.click(within(acme).getByRole("button", { name: "Analisar" }));
    expect(analyzePosting).toHaveBeenCalledWith("p1");
  });

  it("M7 · filtros: plataforma, só novas, só link que não abriu e o aviso quando nada sobra", async () => {
    renderApp({
      api: {
        listPostings: async () => ({ postings: [] }),
        listFeed: async () => ({
          postings: [
            mail("p1", { company: "Acme" }),
            mail("p2", {
              company: "Globex",
              feedState: "seen",
              linkStatus: "ok",
              sourceRef: {
                gmailId: "g",
                platform: "glassdoor",
                mailUrl: null,
                receivedAt: null,
                trusted: true,
              },
            }),
          ],
        }),
      } as never,
      initialUrl: "/vagas",
    });
    await userEvent.click(await screen.findByRole("tab", { name: "Feed do e-mail" }));
    const list = await screen.findByRole("list", { name: "Feed do e-mail" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    await userEvent.selectOptions(screen.getByLabelText("Plataforma"), "glassdoor");
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.getAttribute("aria-label")),
    ).toEqual([expect.stringMatching(/Globex/)]);
    await userEvent.click(screen.getByLabelText("Só as novas"));
    expect(await screen.findByText("Nenhuma vaga com esses filtros.")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Plataforma"), "");
    await userEvent.click(screen.getByLabelText("Só link que não abriu"));
    const again = await screen.findByRole("list", { name: "Feed do e-mail" });
    expect(within(again).getAllByRole("listitem")).toHaveLength(1);
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
