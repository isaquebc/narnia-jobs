import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FormGuardProvider, useFormGuard } from "../../src/app/FormGuard";
import { ProfileSwitcher } from "../../src/components/shell/ProfileSwitcher";
import { renderWithProviders } from "../helpers";
import { profile } from "./profile-fixture";

function DirtyForm() {
  const guard = useFormGuard();
  return (
    <button type="button" onClick={() => guard.setDirty(true)}>
      sujar
    </button>
  );
}

describe("ProfileSwitcher · seletor de perfil no shell (F02 §2.5)", () => {
  it("lista só os não arquivados com cargo-alvo, marca o ativo e ativa outro pela API", async () => {
    const activateProfile = vi.fn(async (id: string) => profile(id, { isActive: true }));
    renderWithProviders(<ProfileSwitcher />, {
      api: {
        listProfiles: async () => ({
          profiles: [
            profile("p1", {
              isActive: true,
              name: "Eng. Software",
              targetTitle: "Senior Engineer",
            }),
            profile("p2", { name: "PM", targetTitle: "Project Manager" }),
            profile("p3", { name: "Velho", archivedAt: "2026-10-01T00:00:00.000Z" }),
          ],
        }),
        activateProfile,
      },
    });
    const trigger = await screen.findByRole("button", { name: /Trocar perfil/ });
    await waitFor(() => expect(trigger).toHaveTextContent("Eng. Software"));
    await userEvent.click(trigger);
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Project Manager")).toBeInTheDocument();
    expect(within(menu).queryByText("Velho")).not.toBeInTheDocument();
    expect(within(menu).getByRole("menuitemradio", { name: /Eng\. Software/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(menu).getByRole("link", { name: "+ Novo perfil" })).toHaveAttribute(
      "href",
      "/perfis/novo",
    );
    expect(within(menu).getByRole("link", { name: "Gerenciar perfis" })).toHaveAttribute(
      "href",
      "/perfis",
    );
    await userEvent.click(within(menu).getByRole("menuitemradio", { name: /PM/ }));
    expect(activateProfile).toHaveBeenCalledWith("p2");
  });

  it("com formulário sujo pergunta antes de trocar; recusar não chama a API", async () => {
    const activateProfile = vi.fn(async (id: string) => profile(id, { isActive: true }));
    const confirm = vi.fn(() => false);
    renderWithProviders(
      <FormGuardProvider confirm={confirm}>
        <DirtyForm />
        <ProfileSwitcher />
      </FormGuardProvider>,
      {
        api: {
          listProfiles: async () => ({
            profiles: [profile("p1", { isActive: true }), profile("p2", { name: "PM" })],
          }),
          activateProfile,
        },
      },
    );
    await userEvent.click(await screen.findByRole("button", { name: "sujar" }));
    await userEvent.click(screen.getByRole("button", { name: /Trocar perfil/ }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /PM/ }));
    expect(confirm).toHaveBeenCalled();
    expect(activateProfile).not.toHaveBeenCalled();
  });

  it("sem perfil mostra 'Sem perfil ainda'", async () => {
    renderWithProviders(<ProfileSwitcher />, {
      api: { listProfiles: async () => ({ profiles: [] }) },
    });
    expect(await screen.findByText("Sem perfil ainda")).toBeInTheDocument();
  });
});
