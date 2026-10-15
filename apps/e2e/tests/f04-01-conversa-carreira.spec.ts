import { expect, test } from "@playwright/test";
import { sendInUi } from "../helpers/chat";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

test("F04/E2E-01 conversa de carreira: Chat em Geral (recrutador global), ferramenta real chamada, resposta com fonte, uso, tema e autor", async ({
  page,
}) => {
  await freshStart("engineer");
  await login(page);
  // menu: o recrutador é global (F06-8), então "Chat" fica em Geral, não no grupo do perfil ativo
  const nav = page.getByRole("navigation");
  const general = nav.getByRole("group", { name: "Geral" });
  await expect(
    nav.getByRole("group", { name: "Eng. Software Sênior" }).getByRole("link", { name: "Chat" }),
  ).toHaveCount(0);
  await general.getByRole("link", { name: "Chat" }).click();
  await page.getByRole("button", { name: "Nova conversa" }).click();
  const list = await sendInUi(page, "o que está fraco no meu perfil?", /conquistas sem métrica/);
  // chip da ferramenta real do /mcp, com duração, e a fonte citada no texto
  await expect(list.getByText("evidence_experience_list").first()).toBeVisible();
  await expect(list.getByText(/fonte: evidence_experience_list/)).toBeVisible();
  await expect(page.getByTestId("session-usage")).not.toContainText("conversa: 0 tokens");
  // título só "Recrutador" (recrutador global, 2026-10-15), autor com o perfil e a senioridade do recrutador e o tema
  // escolhido pelo modelo mais barato a partir da primeira mensagem (o mock usa as primeiras palavras), já no menu
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Recrutador");
  await expect(list.getByText("Recrutador Eng. Software Sênior Sênior").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "O que está fraco no", exact: true }),
  ).toBeVisible();
  await expect(
    nav.getByRole("list", { name: "Conversas do chat" }).getByRole("link", {
      name: "O que está fraco no",
    }),
  ).toBeVisible();
});
