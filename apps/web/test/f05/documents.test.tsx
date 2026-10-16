import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type DocumentView } from "../../src/lib/api";
import { profile } from "../components/profile-fixture";
import { shellApi } from "../f03/shell-api";
import { analysis, posting } from "../f06/fixtures";
import { renderApp } from "../router-helpers";

/** F05/M5 · telas do CV e da carta: aba do perfil, "Gerar" na vaga, idioma não coberto, painel, bandeja e chat. */
const ready = (
  over: Partial<DocumentView> = {},
  version: Partial<NonNullable<DocumentView["current"]>> = {},
): DocumentView => ({
  document: {
    id: "d1",
    kind: "cv",
    profileId: "p1",
    postingId: null,
    templateId: "classico",
    paper: "A4",
    locale: "pt-BR",
    format: "pdf",
    currentVersion: 1,
    createdAt: "2026-10-16T12:00:00Z",
    updatedAt: "2026-10-16T12:00:00Z",
  },
  current: {
    id: "v1",
    documentId: "d1",
    version: 1,
    source: "agent",
    instructions: null,
    templateId: "classico",
    locale: "pt-BR",
    paper: "A4",
    format: "pdf",
    content: {
      meta: {
        kind: "cv",
        locale: "pt-BR",
        paper: "A4",
        profileId: "p1",
        postingId: null,
        generatedAt: "2026-10-16T12:00:00Z",
      },
      header: { name: "Ana", title: "Eng", location: null, email: null, phone: null, links: [] },
      summary: "Resumo.",
      experiences: [
        {
          factId: "e1",
          company: "Acme",
          title: "Eng",
          start: "2021-01",
          end: null,
          location: null,
          bullets: [],
          tech: [],
          matchScore: 92,
        },
      ],
      skills: [
        {
          label: "Backend",
          items: [{ name: "Node.js", factIds: [{ kind: "skill", id: "s1" }], matchScore: 95 }],
        },
      ],
      projects: [],
      education: [],
      languages: [],
      adjacent: [{ asked: "Kubernetes", shown: "Docker", factIds: [{ kind: "skill", id: "s2" }] }],
      sectionsOrder: ["summary", "experience"],
      omitted: [
        {
          factId: "e0",
          company: "Startup X",
          title: "Estagiária",
          reason: "Pouca aderência (score 10).",
          matchScore: 10,
        },
      ],
      provenance: { factIdsUsed: [], unverifiedFactIds: [{ kind: "skill", id: "s9" }] },
    },
    status: "ready",
    attempts: 1,
    review: { passed: true, atsScore: 94, issues: [] },
    atsScore: 94,
    pagesRendered: 2,
    pdfPath: "documents/d1/v1/cv.pdf",
    textBody: null,
    error: null,
    createdAt: "2026-10-16T12:00:00Z",
    updatedAt: "2026-10-16T12:30:00Z",
    ...version,
  },
  versions: [
    {
      id: "v1",
      version: 1,
      status: "ready",
      source: "agent",
      atsScore: 94,
      pagesRendered: 2,
      createdAt: "2026-10-16T12:00:00Z",
      passed: true,
    },
  ],
  stale: { facts: false, profile: false, posting: false },
  missingLinks: ["linkedin"],
  ...over,
});

function api(overrides: Record<string, unknown> = {}) {
  return {
    ...shellApi,
    listProfiles: async () => ({
      profiles: [
        profile("p1", { isActive: true, name: "Eng" }),
        profile("p2", { name: "Tech Lead" }),
      ],
    }),
    getProfile: async (id: string) => profile(id, { name: id === "p1" ? "Eng" : "Tech Lead" }),
    listNotifications: async () => ({ notifications: [], unresolved: 0 }),
    listIngestions: async () => ({ runs: [] }),
    listChatSessions: async () => ({ sessions: [] }),
    listPendingNotes: async () => ({ notes: [] }),
    listDocuments: vi.fn(async () => ({ documents: [] as DocumentView[] })),
    generateDocument: vi.fn(async () => ({ documents: [] })),
    regenerateDocument: vi.fn(async () => ready()),
    addUserLink: vi.fn(async () => ({ user: {} })),
    documentPdfUrl: (id: string, v: number) => `/api/documents/${id}/versions/${v}/pdf`,
    documentPageUrl: (id: string, v: number, p: number) =>
      `/api/documents/${id}/versions/${v}/pages/${p}`,
    getPosting: vi.fn(async (id: string) => ({
      posting: posting(id),
      contacts: [],
      notes: [],
      duplicates: [],
    })),
    listPostingAnalyses: vi.fn(async () => ({ analyses: [] })),
    ...overrides,
  };
}

describe("F05/M5 · Perfil › Currículo", () => {
  it("sem CV: 'Gerar currículo' abre o diálogo e manda o perfil e as instruções", async () => {
    const generateDocument = vi.fn(async () => ({ documents: [] }));
    renderApp({ api: api({ generateDocument }) as never, initialUrl: "/perfis/p1/curriculo" });
    expect(await screen.findByText("Ainda não há currículo para este perfil.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Gerar currículo" }));
    const dialog = await screen.findByRole("dialog", { name: "Gerar currículo" });
    await userEvent.type(
      within(dialog).getByLabelText("Instruções (opcional)"),
      "foco em liderança",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Gerar" }));
    expect(generateDocument).toHaveBeenCalledWith({
      kind: "cv",
      profileId: "p1",
      postingId: null,
      instructions: "foco em liderança",
    });
  });

  it("CV pronto: data, ATS, PDF, páginas, desatualizado, não verificados, scores, roteiro, adjacência e documentos de vagas", async () => {
    const fromPosting = ready({
      document: { ...ready().document, id: "d2", postingId: "v1", kind: "cover_letter" },
      stale: null,
    });
    renderApp({
      api: api({
        listDocuments: vi.fn(async () => ({
          documents: [
            ready({ stale: { facts: true, profile: false, posting: false } }),
            fromPosting,
          ],
        })),
      }) as never,
      initialUrl: "/perfis/p1/curriculo",
    });
    expect((await screen.findAllByText("Pronto")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Gerado em 16\/10\/2026/)).toBeInTheDocument();
    expect(screen.getByText("ATS 94%")).toBeInTheDocument();
    expect(screen.getByText(/Desatualizado: seus dados mudaram/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Baixar PDF" })).toHaveAttribute(
      "href",
      "/api/documents/d1/versions/1/pdf",
    );
    expect(screen.getByRole("img", { name: "Página 2" })).toHaveAttribute(
      "src",
      "/api/documents/d1/versions/1/pages/2",
    );
    expect(screen.getByText(/1 fato\(s\) ainda não verificado/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Experiências (score de match)" })).toHaveTextContent(
      "Acme · Eng — 92",
    );
    expect(
      screen.getByRole("region", { name: "Roteiro para aprofundar na entrevista" }),
    ).toHaveTextContent("Startup X");
    expect(screen.getByText("a vaga pede Kubernetes; o CV mostra Docker")).toBeInTheDocument();
    const others = screen.getByRole("region", {
      name: "Currículos e cartas de vagas com este perfil",
    });
    expect(within(others).getByRole("link", { name: "Abrir a vaga" })).toHaveAttribute(
      "href",
      "/vagas/v1?doc=d2",
    );
  });

  it("link que falta: o atalho cadastra o LinkedIn", async () => {
    const addUserLink = vi.fn(async () => ({ user: {} }));
    renderApp({
      api: api({
        addUserLink,
        listDocuments: vi.fn(async () => ({ documents: [ready()] })),
      }) as never,
      initialUrl: "/perfis/p1/curriculo",
    });
    expect(await screen.findByText("Faltam no cabeçalho do PDF: LinkedIn.")).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText("Link do LinkedIn"),
      "https://www.linkedin.com/in/ana",
    );
    await userEvent.click(screen.getByRole("button", { name: "Salvar link" }));
    expect(addUserLink).toHaveBeenCalledWith({
      label: "LinkedIn",
      url: "https://www.linkedin.com/in/ana",
    });
    expect(await screen.findByText(/Link salvo/)).toBeInTheDocument();
  });

  it("não passou na revisão: alerta com os apontamentos; Atualizar manda as instruções", async () => {
    const regenerateDocument = vi.fn(async () => ready());
    const failed = ready(
      {},
      {
        status: "ready_with_issues",
        attempts: 2,
        review: {
          passed: false,
          atsScore: 81,
          issues: [
            {
              area: "ats",
              severity: "error",
              message: "Aderência a ATS de 81% (mínimo 90%).",
              where: null,
            },
            {
              area: "layout",
              severity: "warning",
              message: "Última página quase vazia.",
              where: "página 2",
            },
          ],
        },
        atsScore: 81,
      },
    );
    renderApp({
      api: api({
        regenerateDocument,
        listDocuments: vi.fn(async () => ({ documents: [failed] })),
      }) as never,
      initialUrl: "/perfis/p1/curriculo",
    });
    const alert = await screen.findByRole("alert", { name: "Não passou na revisão" });
    expect(alert).toHaveTextContent("ATS: Aderência a ATS de 81% (mínimo 90%).");
    expect(alert).not.toHaveTextContent("Última página");
    await userEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    const dialog = await screen.findByRole("dialog", { name: "Atualizar: Currículo" });
    await userEvent.type(within(dialog).getByLabelText("Instruções (opcional)"), "mais curto");
    await userEvent.click(within(dialog).getByRole("button", { name: "Atualizar" }));
    expect(regenerateDocument).toHaveBeenCalledWith("d1", {
      instructions: "mais curto",
      acceptLanguage: true,
    });
  });

  it("gerando: mostra a etapa e o Atualizar fica desligado", async () => {
    renderApp({
      api: api({
        listDocuments: vi.fn(async () => ({
          documents: [ready({}, { status: "reviewing", pagesRendered: null })],
        })),
      }) as never,
      initialUrl: "/perfis/p1/curriculo",
    });
    expect(await screen.findByText("Revisando")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Atualizar" })).toBeDisabled();
  });
});

describe("F05/M5 · vaga › Gerar", () => {
  it("menu Gerar › Cover letter: perfil recomendado por padrão; idioma não coberto pergunta e 'Continuar' manda acceptLanguage", async () => {
    const generateDocument = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(
          409,
          "language_not_covered",
          "A vaga é em inglês, e o seu currículo não mostra inglês fluente. Gerar mesmo assim?",
          { language: "Inglês" },
        ),
      )
      .mockResolvedValueOnce({ documents: [] });
    renderApp({
      api: api({
        generateDocument,
        listPostingAnalyses: vi.fn(async () => ({
          analyses: [analysis({ recommendedProfileId: "p2" })],
        })),
      }) as never,
      initialUrl: "/vagas/v1",
    });
    await userEvent.click(await screen.findByRole("button", { name: "Gerar" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Cover letter" }));
    const dialog = await screen.findByRole("dialog", { name: "Gerar carta de apresentação" });
    expect((within(dialog).getByLabelText("Perfil") as HTMLSelectElement).value).toBe("p2");
    expect(
      within(dialog).getByRole("option", { name: "Tech Lead (recomendado pela análise)" }),
    ).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText("Formato da carta"), "text");
    await userEvent.click(within(dialog).getByRole("button", { name: "Gerar" }));
    expect(await within(dialog).findByText(/não mostra inglês fluente/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Continuar mesmo assim" }));
    await waitFor(() =>
      expect(generateDocument).toHaveBeenLastCalledWith({
        kind: "cover_letter",
        profileId: "p2",
        postingId: "v1",
        instructions: null,
        acceptLanguage: true,
        format: "text",
      }),
    );
  });

  it("?gerar=cv abre o Gerar com 'carta junto'; Parar fecha sem gerar de novo", async () => {
    const generateDocument = vi
      .fn()
      .mockRejectedValue(
        new ApiError(409, "language_not_covered", "Idioma não coberto.", { language: "Inglês" }),
      );
    renderApp({
      api: api({ generateDocument }) as never,
      initialUrl: "/vagas/v1?gerar=cv&perfil=p1",
    });
    const dialog = await screen.findByRole("dialog", { name: "Gerar currículo" });
    await userEvent.click(within(dialog).getByLabelText("Gerar a carta de apresentação junto"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Gerar" }));
    expect(generateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "cv",
        profileId: "p1",
        withCoverLetter: true,
        format: "pdf",
      }),
    );
    await userEvent.click(await within(dialog).findByRole("button", { name: "Parar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(generateDocument).toHaveBeenCalledTimes(1);
  });

  it("documentos da vaga: carta em texto com 'Copiar texto', com o perfil no título", async () => {
    const letter = ready(
      {
        document: {
          ...ready().document,
          id: "d3",
          kind: "cover_letter",
          postingId: "v1",
          profileId: "p2",
          format: "text",
        },
        missingLinks: [],
      },
      {
        content: null,
        textBody: "Olá, time da Initech.\n\nMe candidato…",
        pagesRendered: null,
        pdfPath: null,
        atsScore: null,
      },
    );
    renderApp({
      api: api({ listDocuments: vi.fn(async () => ({ documents: [letter] })) }) as never,
      initialUrl: "/vagas/v1?doc=d3",
    });
    const section = await screen.findByRole("region", { name: "Currículos e cartas" });
    expect(
      await within(section).findByText("Carta de apresentação · Tech Lead"),
    ).toBeInTheDocument();
    expect(within(section).getByText(/Olá, time da Initech/)).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Copiar" })).toBeInTheDocument();
    expect(within(section).queryByRole("link", { name: "Baixar PDF" })).toBeNull();
  });
});

describe("F05/M5 · bandeja", () => {
  it("currículo pronto e não aprovado aparecem na bandeja e contam no número", async () => {
    const n = (id: string, kind: string, title: string) => ({
      id,
      kind,
      severity: kind === "document.ready" ? "info" : "warning",
      title,
      body: null,
      subjectKind: "document",
      subjectId: "d1",
      actionUrl: "/perfis/p1/curriculo",
      createdAt: "2026-10-16T12:00:00Z",
      readAt: null,
      resolvedAt: null,
      dismissedAt: null,
    });
    renderApp({
      api: api({
        listNotifications: async () => ({
          notifications: [
            n("n1", "document.ready", "Pronto: Currículo · Eng"),
            n("n2", "document.review_failed", "Não passou na revisão: Carta · Initech"),
          ],
          unresolved: 1,
        }),
      }) as never,
      initialUrl: "/dashboard",
    });
    await waitFor(() => expect(screen.getByTestId("activity-count")).toHaveTextContent("2"));
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /Atividade/ }));
    });
    const tray = screen.getByRole("list", { name: "Currículos e cartas" });
    expect(tray).toHaveTextContent("Pronto: Currículo · Eng");
    expect(tray).toHaveTextContent("Não passou na revisão: Carta · Initech");
  });
});
