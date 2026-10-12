import { expect, test } from "@playwright/test";
import { api } from "../helpers/api";
import { createSession, sendInUi } from "../helpers/chat";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

interface ProfileBody {
  salary?: { min: number; max: number; currency: string; period: string };
  needsResearch: string[];
}

test("F04/E2E-14 valor pesquisado: o usuário confirma na conversa e a faixa entra no perfil com a fonte aceita", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  // o usuário respondeu "não sei" ao salário no primeiro uso
  await api(`/api/profiles/${ids.profileId}`, {
    method: "PATCH",
    body: JSON.stringify({ needsResearch: ["salary"] }),
  });
  const s = await createSession({ profileId: ids.profileId, title: "Salário" });
  await login(page, `/chat/${s.id}`);

  await sendInUi(page, "qual o salário de mercado para o meu cargo?", /fonte oficial do IBGE/);
  await sendInUi(page, "pode usar esse valor de 12 a 16 mil por mês", /Gravei a faixa/);

  const profile = await api<ProfileBody>(`/api/profiles/${ids.profileId}`);
  expect(profile.salary).toMatchObject({ min: 12000, max: 16000, currency: "BRL" });
  expect(profile.needsResearch).not.toContain("salary");
  const panel = page.getByRole("complementary", { name: "Contexto" });
  await expect(panel.getByText("Valor aceito")).toBeVisible();
  await expect(panel.getByText("Oficial").first()).toBeVisible();
});
