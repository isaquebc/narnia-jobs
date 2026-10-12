import { expect, test } from "@playwright/test";
import { createProfile, createSession, say } from "../helpers/chat";
import { freshStart } from "../helpers/ingest";
import { login, switchTo } from "../helpers/profiles";

test("F04/E2E-02 abas por perfil: conversas do perfil A somem ao trocar para B e voltam com o histórico", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const pm = await createProfile("Gestão de Engenharia");
  const a1 = await createSession({ profileId: ids.profileId, title: "Conversa A1" });
  await createSession({ profileId: ids.profileId, title: "Conversa A2" });
  await createSession({ profileId: pm.id, title: "Conversa B1" });
  await say(a1.id, "o que está fraco?");

  await login(page, `/chat/${a1.id}`);
  const tabs = page.getByRole("navigation", { name: "Conversas" });
  await expect(tabs.getByText("Conversa A1")).toBeVisible();
  await expect(tabs.getByText("Conversa A2")).toBeVisible();
  await expect(tabs.getByText("Conversa B1")).toHaveCount(0);

  await switchTo(page, "Gestão de Engenharia");
  await expect(tabs.getByText("Conversa B1")).toBeVisible();
  await expect(tabs.getByText("Conversa A1")).toHaveCount(0);

  await switchTo(page, "Eng. Software Sênior");
  await tabs.getByText("Conversa A1").click();
  await expect(
    page.getByRole("list", { name: "Mensagens" }).getByText(/conquistas sem métrica/),
  ).toBeVisible();
});
