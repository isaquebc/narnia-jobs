import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SideNav } from "../../src/components/shell/SideNav";
import { renderWithProviders } from "../helpers";
import { profile } from "./profile-fixture";

/** Menu em dois grupos (pedido do dono, 2026-10-11): perfil atual × geral; primeiro uso bloqueia ou some. */
const active = profile("p1", { name: "Engenheiro Backend", isActive: true });

function api(completed: boolean, profiles = [active]) {
  return {
    getOnboardingState: async () => ({ step: completed ? 5 : 2, completed }),
    listProfiles: async () => ({ profiles }),
  };
}

describe("SideNav · grupos perfil atual e geral", () => {
  it("onboarding concluído: grupo com o nome do perfil ativo (Dashboard) e grupo Geral; sem Primeiro uso", async () => {
    renderWithProviders(<SideNav />, { api: api(true) });
    const current = await screen.findByRole("group", { name: "Engenheiro Backend" });
    expect(within(current).getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    const general = screen.getByRole("group", { name: "Geral" });
    for (const name of ["Perfis", "Ingestão", "Evidências", "Pendências", "Configurações"])
      expect(within(general).getByRole("link", { name })).toBeInTheDocument();
    expect(within(general).queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Primeiro uso" })).not.toBeInTheDocument();
  });

  it("onboarding não concluído: só Primeiro uso está disponível", async () => {
    renderWithProviders(<SideNav />, { api: api(false, []) });
    expect(await screen.findByRole("link", { name: "Primeiro uso" })).toBeInTheDocument();
    for (const name of [
      "Dashboard",
      "Perfis",
      "Ingestão",
      "Evidências",
      "Pendências",
      "Configurações",
    ])
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
  });
});
