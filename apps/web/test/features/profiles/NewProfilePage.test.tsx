import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NewProfilePage } from "../../../src/features/profiles/NewProfilePage";
import type { ApiClient } from "../../../src/lib/api";
import { profile } from "../../components/profile-fixture";
import { renderWithProviders } from "../../helpers";

const user = {
  user: {
    id: "u1",
    displayName: "Ana",
    fullName: "Ana Maria Exemplo",
    email: "ana@example.com",
    phone: { e164: "+5511987654321", country: "BR", national: "11987654321" },
    city: "Campinas",
    region: "SP",
    country: "BR",
    timezone: "America/Sao_Paulo",
    remotePref: "remote" as const,
    relocation: { mode: "none" as const, countries: [] },
    workAuth: [{ country: "BR", status: "citizen" as const }],
    links: [],
    languages: [],
  },
};

function setup(search: Record<string, string>) {
  const fakes = {
    getUser: vi.fn(async () => user),
    listProfiles: vi.fn(async () => ({
      profiles: [profile("p1", { name: "Eng. Software", targetTitle: "Senior Engineer" })],
    })),
    getSalaryReference: vi.fn(async () => ({ reference: null })),
    createProfile: vi.fn(async (body: { name: string }) => profile("new", { name: body.name })),
    cloneProfile: vi.fn(async (_src: string, body: { name: string }) =>
      profile("cl", { name: body.name }),
    ),
    getProfile: vi.fn(async (id: string) =>
      profile(id, {
        name: "Eng. Software",
        targetTitle: "Senior Engineer",
        altTitles: ["Backend Engineer"],
        seniority: "senior",
        area: "software",
        market: "BR",
        docLocale: "pt-BR",
        goal: "new_job",
        salary: { min: 10000, max: 15000, currency: "BRL", period: "monthly" },
      }),
    ),
  };
  const onDone = vi.fn();
  const utils = renderWithProviders(<NewProfilePage search={search} onDone={onDone} />, {
    api: fakes as unknown as Partial<ApiClient>,
  });
  return { ...utils, fakes, onDone };
}

async function fillCareerAsDontKnow() {
  for (const box of await screen.findAllByRole("checkbox", { name: "Não sei" }))
    await userEvent.click(box);
}

describe("NewProfilePage · do zero, clonando e a partir de sugestão (F02 §4, F02-8)", () => {
  it("do zero: exige carreira; com 'não sei' cria pelo POST sem ativar e chama onDone", async () => {
    const { fakes, onDone } = setup({});
    expect(await screen.findByRole("heading", { name: "Novo perfil" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Nome do perfil/), "PM");
    await userEvent.type(screen.getByLabelText(/Cargo-alvo/), "Project Manager");
    await userEvent.type(screen.getByLabelText(/Área/), "gestão");
    await userEvent.click(screen.getByRole("button", { name: "Criar perfil" }));
    expect(await screen.findByText(/Preencha os campos obrigatórios/)).toBeInTheDocument();
    expect(fakes.createProfile).not.toHaveBeenCalled();
    await fillCareerAsDontKnow();
    await userEvent.click(screen.getByRole("button", { name: "Criar perfil" }));
    await waitFor(() => expect(fakes.createProfile).toHaveBeenCalled());
    const body = fakes.createProfile.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.name).toBe("PM");
    expect(body.activate).toBeUndefined();
    expect(body.needsResearch).toEqual(["salary", "contractTypes", "locations", "availableFrom"]);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("new"));
  });

  it("clonando: pré-preenche tudo menos carreira e chama POST …/clone com o perfil de origem", async () => {
    const { fakes } = setup({ cloneFrom: "p1" });
    expect(await screen.findByDisplayValue("Senior Engineer")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Backend Engineer")).toBeInTheDocument();
    expect(screen.getByLabelText(/Nome do perfil/)).toHaveValue("Cópia de Eng. Software");
    expect(screen.getByRole("combobox", { name: "Clonar de" })).toHaveValue("p1");
    // carreira não vem do perfil de origem
    expect(screen.getByLabelText("Mínimo")).not.toHaveValue("10000");
    await fillCareerAsDontKnow();
    await userEvent.click(screen.getByRole("button", { name: "Criar perfil" }));
    await waitFor(() => expect(fakes.cloneProfile).toHaveBeenCalled());
    expect(fakes.cloneProfile.mock.calls[0]?.[0]).toBe("p1");
    expect(fakes.createProfile).not.toHaveBeenCalled();
  });

  it("a partir de sugestão: alvo, senioridade, área e mercado pré-preenchidos, com aviso", async () => {
    setup({
      suggestionId: "sg1",
      title: "Engineering Manager",
      seniority: "manager",
      area: "engineering management",
      market: "BR",
    });
    expect(
      await screen.findByText("Pré-preenchido a partir da sugestão “Engineering Manager”."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Cargo-alvo/)).toHaveValue("Engineering Manager");
    expect(screen.getByLabelText(/Senioridade/)).toHaveValue("manager");
    expect(screen.getByLabelText(/Área/)).toHaveValue("engineering management");
  });
});
