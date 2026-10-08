import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProfilesPage } from "../../../src/features/profiles/ProfilesPage";
import { type ApiClient, ApiError } from "../../../src/lib/api";
import { profile } from "../../components/profile-fixture";
import { renderWithProviders } from "../../helpers";

const suggestion = (id: string, source: "heuristic" | "model", title: string) => ({
  id,
  userId: "u1",
  source,
  model: source === "model" ? "sonnet" : null,
  payload: {
    title,
    seniority: "manager" as const,
    area: "engineering management",
    market: "BR",
    rationale: "3 anos liderando squads",
    supportingFactIds: ["e1", "e2"],
  },
  status: "new" as const,
  createdAt: "2026-10-08T12:00:00.000Z",
  decidedAt: null,
});

function setup(overrides: Partial<ApiClient> = {}) {
  const profiles = [
    profile("p1", {
      isActive: true,
      name: "Eng. Software",
      targetTitle: "Senior Engineer",
      cardUpdatedAt: "2026-10-08T15:00:00.000Z",
    }),
    profile("p2", { name: "PM", targetTitle: "Project Manager" }),
    profile("p3", { name: "Velho", archivedAt: "2026-10-01T00:00:00.000Z" }),
  ];
  const api = {
    listProfiles: vi.fn(async (opts?: { archived?: boolean }) => ({
      profiles: opts?.archived ? profiles : profiles.filter((p) => !p.archivedAt),
    })),
    listSuggestions: vi.fn(async () => ({
      suggestions: [
        suggestion("sg1", "heuristic", "Engineering Manager"),
        suggestion("sg2", "model", "Staff Engineer"),
      ],
    })),
    dismissSuggestion: vi.fn(async () => ({ ok: true as const })),
    archiveProfile: vi.fn(async (id: string) => {
      if (id === "p1")
        throw new ApiError(409, "profile_active", "O perfil ativo não pode ser arquivado");
      return profile(id, { archivedAt: "2026-10-08T16:00:00.000Z" });
    }),
    unarchiveProfile: vi.fn(async (id: string) => profile(id)),
    activateProfile: vi.fn(async (id: string) => profile(id, { isActive: true })),
    patchProfile: vi.fn(async (id: string, body: { name?: string }) =>
      profile(id, { name: body.name ?? id }),
    ),
    getAnalyzeEstimate: vi.fn(async () => ({ model: "sonnet", tokens: 2092, inputChars: 8000 })),
    analyzeProfiles: vi.fn(async () => ({
      job: {
        id: "task__profile.analyze__u1",
        queue: "extract" as const,
        type: "profile.analyze",
        parentId: null,
        profileId: null,
        status: "queued" as const,
        progress: 0,
        stage: "profile.analyze",
        payload: {},
        result: null,
        error: null,
        attempts: 0,
        createdAt: "2026-10-08T12:00:00.000Z",
        startedAt: null,
        finishedAt: null,
      },
    })),
    listJobs: vi.fn(async () => ({ jobs: [] })),
  };
  const merged = { ...api, ...overrides } as Partial<ApiClient>;
  const utils = renderWithProviders(<ProfilesPage />, {
    api: merged,
    timezone: "America/Sao_Paulo",
  });
  return { ...utils, fakes: api };
}

describe("ProfilesPage · lista, ações, análise e sugestões (F02 §4)", () => {
  it("lista perfis não arquivados com alvo e data do cartão no fuso; 'mostrar arquivados' inclui o arquivado", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Perfis" })).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Perfis" });
    expect(within(list).getByText("Senior Engineer")).toBeInTheDocument();
    expect(within(list).getByText("Cartão atualizado em 08/10/2026 12:00")).toBeInTheDocument();
    expect(within(list).queryByText("Velho")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Mostrar arquivados" }));
    expect(await screen.findByText("Velho")).toBeInTheDocument();
    expect(screen.getAllByText("arquivado").length).toBeGreaterThan(0);
  });

  it("arquivar o ativo mostra a mensagem do 409; arquivar outro e desarquivar chamam a API", async () => {
    const { fakes } = setup();
    const list = await screen.findByRole("list", { name: "Perfis" });
    const engineer = within(list).getByRole("listitem", { name: "Eng. Software" });
    await userEvent.click(within(engineer).getByRole("button", { name: "Arquivar" }));
    expect(
      await screen.findByText("O perfil ativo não pode ser arquivado. Troque de perfil antes."),
    ).toBeInTheDocument();
    const pm = within(list).getByRole("listitem", { name: "PM" });
    await userEvent.click(within(pm).getByRole("button", { name: "Ativar" }));
    expect(fakes.activateProfile).toHaveBeenCalledWith("p2");
    await userEvent.click(within(pm).getByRole("button", { name: "Arquivar" }));
    await waitFor(() => expect(fakes.archiveProfile).toHaveBeenCalledWith("p2"));
  });

  it("renomear inline chama PATCH com o novo nome", async () => {
    const { fakes } = setup();
    const list = await screen.findByRole("list", { name: "Perfis" });
    const pm = within(list).getByRole("listitem", { name: "PM" });
    await userEvent.click(within(pm).getByRole("button", { name: "Renomear" }));
    const input = within(pm).getByRole("textbox", { name: "Novo nome do perfil" });
    await userEvent.clear(input);
    await userEvent.type(input, "Gerente de Projetos{Enter}");
    await waitFor(() =>
      expect(fakes.patchProfile).toHaveBeenCalledWith("p2", { name: "Gerente de Projetos" }),
    );
  });

  it("'Analisar possíveis perfis' mostra a estimativa antes e enfileira ao confirmar; 409 vira mensagem", async () => {
    const { fakes } = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Analisar possíveis perfis" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText("Estimativa: ~2.1k tokens com sonnet"),
    ).toBeInTheDocument();
    expect(fakes.analyzeProfiles).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirmar e analisar" }));
    await waitFor(() => expect(fakes.analyzeProfiles).toHaveBeenCalledWith({ model: "sonnet" }));
    expect(await screen.findByText(/Análise iniciada/)).toBeInTheDocument();
    fakes.analyzeProfiles.mockRejectedValueOnce(
      new ApiError(409, "analyze_pending", "já em andamento", { jobId: "j1" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Analisar possíveis perfis" }));
    await userEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Confirmar e analisar",
      }),
    );
    expect(await screen.findByText("Já existe uma análise em andamento.")).toBeInTheDocument();
  });

  it("sugestões mostram origem e justificativa; dispensar chama a API", async () => {
    const { fakes } = setup();
    const section = await screen.findByRole("region", { name: "Sugestões de perfil" });
    expect(await within(section).findByText("Engineering Manager")).toBeInTheDocument();
    expect(within(section).getByText("Heurística (sem custo)")).toBeInTheDocument();
    expect(within(section).getByText("Modelo (sonnet)")).toBeInTheDocument();
    expect(within(section).getAllByText("3 anos liderando squads")).toHaveLength(2);
    expect(within(section).getAllByText("2 fatos de apoio")).toHaveLength(2);
    await userEvent.click(
      within(section).getAllByRole("button", { name: "Dispensar" })[1] as HTMLElement,
    );
    await waitFor(() => expect(fakes.dismissSuggestion).toHaveBeenCalledWith("sg2"));
    expect(within(section).getAllByRole("link", { name: "Aceitar" })[0]).toHaveAttribute(
      "href",
      expect.stringContaining("/perfis/novo?"),
    );
  });
});
