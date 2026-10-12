import { expect, test } from "@playwright/test";
import { sendInUi } from "../helpers/chat";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

test("F04/E2E-01 conversa de carreira: Chat no grupo do perfil, ferramenta real chamada, resposta com fonte e uso", async ({
  page,
}) => {
  await freshStart("engineer");
  await login(page);
  // menu: "Chat" fica no grupo com o nome do perfil ativo (não em Geral)
  const nav = page.getByRole("navigation");
  const general = nav.getByRole("group", { name: "Geral" });
  await expect(general.getByRole("link", { name: "Chat" })).toHaveCount(0);
  await nav.getByRole("link", { name: "Chat" }).click();
  await page.getByRole("button", { name: "Nova conversa" }).click();
  const list = await sendInUi(page, "o que está fraco no meu perfil?", /conquistas sem métrica/);
  // chip da ferramenta real do /mcp, com duração, e a fonte citada no texto
  await expect(list.getByText("evidence_experience_list").first()).toBeVisible();
  await expect(list.getByText(/fonte: evidence_experience_list/)).toBeVisible();
  await expect(page.getByTestId("session-usage")).not.toContainText("conversa: 0 tokens");
});
