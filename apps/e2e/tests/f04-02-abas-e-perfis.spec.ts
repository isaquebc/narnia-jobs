import { expect, test } from "@playwright/test";
import { createProfile, createSession, say } from "../helpers/chat";
import { freshStart } from "../helpers/ingest";
import { login, switchTo } from "../helpers/profiles";

test("F04/E2E-02 conversas globais no menu (F06-8): trocar de perfil não esconde nenhuma e a aberta continua", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const pm = await createProfile("Gestão de Engenharia");
  const a1 = await createSession({ profileId: ids.profileId, title: "Conversa A1" });
  await createSession({ profileId: ids.profileId, title: "Conversa A2" });
  await createSession({ profileId: pm.id, title: "Conversa B1" });
  await say(a1.id, "o que está fraco?");

  await login(page, `/chat/${a1.id}`);
  // as conversas ficam como subitens do Chat no menu da esquerda (2026-10-13), de todos os perfis
  const tabs = page.getByRole("list", { name: "Conversas do chat" });
  await expect(tabs.getByText("Conversa A1")).toBeVisible();
  await expect(tabs.getByText("Conversa A2")).toBeVisible();
  await expect(tabs.getByText("Conversa B1")).toBeVisible();

  await switchTo(page, "Gestão de Engenharia");
  await expect(tabs.getByText("Conversa B1")).toBeVisible();
  await expect(tabs.getByText("Conversa A1")).toBeVisible();
  // a conversa aberta não fecha na troca
  await expect(page).toHaveURL(new RegExp(`/chat/${a1.id}$`));
  await expect(
    page.getByRole("list", { name: "Mensagens" }).getByText(/conquistas sem métrica/),
  ).toBeVisible();
});
