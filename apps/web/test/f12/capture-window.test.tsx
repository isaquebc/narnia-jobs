import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { shellApi } from "../f03/shell-api";
import { posting as postingFixture } from "../f06/fixtures";
import { renderApp } from "../router-helpers";

/**
 * F12/M2 · janela `/candidatura` (F12-2): aberta pela extensão numa janela popup, sem o menu do narnia; mostra o que foi
 * lido da página (cargo, empresa, local, trecho), avisa quando parece uma vaga já salva e salva pelo fluxo da F06.
 */
const capture = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  url: "https://vagas.example/123",
  title: "Vagas",
  createdAt: "2026-10-23T12:00:00.000Z",
  postingId: null,
  duplicate: null,
  applicationId: null,
  applicationUrl: null,
  mode: "auto" as const,
  analysis: { requested: false, sessionId: null, error: null },
  reading: {
    ok: true,
    title: "Engenheira Backend Sênior",
    company: "Acme Pagamentos",
    siteName: "Vagas Exemplo",
    location: "São Paulo - SP · híbrido",
    description: `Buscamos uma pessoa engenheira backend para o time de pagamentos.\n\n${"Requisito. ".repeat(80)}\nFim da descrição.`,
    chars: 900,
    message: null,
  },
  ...over,
});

const posting = postingFixture("p1", {
  title: "Engenheira Backend Sênior",
  company: "Acme Pagamentos",
  status: "extracting",
});

/** Depois de salvar, a janela acompanha a vaga (extração e análise) e os documentos. */
const followUpApi = {
  getPosting: async () => ({ posting, contacts: [], notes: [], duplicates: [] }),
  listPostingAnalyses: async () => ({ analyses: [] }),
  listDocuments: async () => ({ documents: [] }),
};

describe("F12/M2 · janela da extensão: vaga", () => {
  it("mostra o que foi lido, sem o menu do narnia, e salva a vaga", async () => {
    let current = capture();
    const saveCapturePosting = vi.fn(async () => {
      current = capture({
        postingId: "p1",
        analysis: { requested: true, sessionId: null, error: null },
      });
      return { posting, job: null };
    });
    renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async () => ({ capture: current }),
        saveCapturePosting,
        ...followUpApi,
      },
      initialUrl: "/candidatura?captura=c1",
    });
    expect(
      await screen.findByRole("heading", { name: "Engenheira Backend Sênior" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Acme Pagamentos")).toBeInTheDocument();
    expect(screen.getByText("São Paulo - SP · híbrido")).toBeInTheDocument();
    // a descrição inteira, sem corte de linhas (testes do dono, 2026-10-23)
    const description = screen.getByText(/time de pagamentos/);
    expect(description).toHaveTextContent(/Fim da descrição\.$/);
    expect(description.className).not.toMatch(/line-clamp/);
    // a janela tem ~480 px: a largura mínima do layout do narnia (1024 px) não vale aqui
    expect(document.querySelector('[data-layout="bare"]')).not.toBeNull();
    expect(screen.getByText(/vagas\.example/)).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Salvar vaga" }));
    expect(saveCapturePosting).toHaveBeenCalledWith("c1");
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/Vaga salva/);
    // salvar também analisa: a janela acompanha a extração (pedido do dono, 2026-10-23)
    expect(await screen.findByText(/Lendo os detalhes da vaga/)).toBeInTheDocument();
    const open = within(status).getByRole("link", { name: "Abrir a vaga no narnia" });
    expect(open).toHaveAttribute("href", "/vagas/p1");
    expect(open).toHaveAttribute("target", "_blank");
  });

  it("parece uma vaga já salva: avisa e oferece abrir a salva, sem impedir salvar", async () => {
    renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async () => ({
          capture: capture({ duplicate: { id: "p9", title: "Backend Sr", company: "Acme" } }),
        }),
      },
      initialUrl: "/candidatura?captura=c1",
    });
    expect(await screen.findByText(/Parece a vaga "Backend Sr · Acme"/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir a salva" })).toHaveAttribute(
      "href",
      "/vagas/p9",
    );
    expect(screen.getByRole("button", { name: "Salvar vaga" })).toBeEnabled();
  });

  it("captura já salva: mostra o link da vaga e o acompanhamento em vez do botão", async () => {
    renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async () => ({ capture: capture({ postingId: "p1" }) }),
        ...followUpApi,
      },
      initialUrl: "/candidatura?captura=c1",
    });
    expect(await screen.findByText(/Vaga salva no narnia/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir a vaga no narnia" })).toHaveAttribute(
      "href",
      "/vagas/p1",
    );
    expect(screen.queryByRole("button", { name: "Salvar vaga" })).toBeNull();
  });

  it("página que não deu para ler: a mensagem e o caminho de colar o texto", async () => {
    renderApp({
      api: {
        ...shellApi,
        getExtensionCapture: async () => ({
          capture: capture({
            reading: {
              ok: false,
              title: null,
              company: null,
              siteName: null,
              location: null,
              description: null,
              chars: 0,
              message: "O site bloqueou a leitura automática desta página. Cole o texto da vaga.",
            },
          }),
        }),
      },
      initialUrl: "/candidatura?captura=c1",
    });
    expect(await screen.findByText(/O site bloqueou a leitura/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Colar a descrição em Vagas" })).toHaveAttribute(
      "href",
      "/vagas",
    );
    expect(screen.queryByRole("button", { name: "Salvar vaga" })).toBeNull();
  });

  it("a extensão não conseguiu ler a aba (página do Chrome, sem permissão)", async () => {
    renderApp({ api: shellApi, initialUrl: "/candidatura?erro=leitura" });
    expect(await screen.findByText(/Não consegui ler esta aba/)).toBeInTheDocument();
  });

  it("o narnia recusou o envio da página", async () => {
    renderApp({ api: shellApi, initialUrl: "/candidatura?erro=envio" });
    expect(await screen.findByText(/o narnia não aceitou o envio/)).toBeInTheDocument();
  });
});
