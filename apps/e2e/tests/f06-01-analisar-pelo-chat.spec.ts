import { expect, type Page, test } from "@playwright/test";
import { freshStart } from "../helpers/ingest";
import { JD, listPostings } from "../helpers/postings";
import { login } from "../helpers/profiles";

async function newConversation(page: Page) {
  const nav = page.getByRole("navigation");
  await nav.getByRole("group", { name: "Geral" }).getByRole("link", { name: /^Chat/ }).click();
  await page.getByRole("button", { name: "Nova conversa" }).click();
  return {
    nav,
    box: page.getByRole("textbox", { name: "Mensagem para o recrutador" }),
    messages: page.getByRole("list", { name: "Mensagens" }),
  };
}

test("F06/E2E-01 analisar pelo chat: vaga na primeira mensagem, a própria conversa vira a 'contratante/cliente - role' e a análise aparece na página da vaga", async ({
  page,
}) => {
  await freshStart("engineer");
  await login(page);
  const { nav, box, messages: list } = await newConversation(page);
  await box.fill(`analisa esta vaga: ${JD}`);
  await page.getByRole("button", { name: "Enviar" }).click();
  // conversa nova: segue nela (pedido do dono, 2026-10-24), que ganha o título da vaga (o mock percorre a skill)
  await expect(
    page.getByRole("heading", { level: 2, name: "Globex Consultoria/Initech Bank - Backend" }),
  ).toBeVisible();
  await expect(list.getByText(/Análise gravada/)).toBeVisible();
  await expect(list.getByRole("link", { name: "Abrir a conversa da análise" })).toHaveCount(0);
  // F05: "Criar CV para esta vaga" abre o Gerar na página da vaga
  await expect(list.getByRole("link", { name: "Criar CV para esta vaga" })).toHaveAttribute(
    "href",
    /\/vagas\/[^/?]+\?gerar=cv$/,
  );
  // o menu de conversas mostra a conversa com o título da vaga (uma conversa só: lista sem grupos)
  await expect(
    nav.getByRole("link", { name: /Globex Consultoria\/Initech Bank - Backend/ }),
  ).toBeVisible();
  // a página da vaga mostra a análise gravada
  await list.getByRole("link", { name: "Abrir a vaga" }).first().click();
  await expect(page.getByRole("list", { name: "Fit por perfil" })).toContainText(
    "Eng. Software Sênior",
  );
  await expect(
    page.getByRole("list", { name: "Fit por perfil" }).getByText("Recomendado"),
  ).toBeVisible();
  expect((await listPostings()).length).toBe(1);
  // a lista de Vagas tem o card
  await nav.getByRole("link", { name: "Vagas" }).click();
  await expect(
    page
      .getByRole("list", { name: "Vagas" })
      .getByRole("listitem", { name: "Globex Consultoria / Initech Bank" }),
  ).toContainText("Desenvolvedor(a) Backend Sênior");
});

test("F06/E2E-01b conversa que já tinha outro assunto: a vaga abre a conversa própria da análise", async ({
  page,
}) => {
  await freshStart("engineer");
  await login(page);
  const { box, messages } = await newConversation(page);
  await box.fill("Oi! Hoje quero focar em vagas de backend remotas.");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(messages.getByRole("listitem")).toHaveCount(2, { timeout: 30_000 });
  await box.fill(`analisa esta vaga: ${JD}`);
  await page.getByRole("button", { name: "Enviar" }).click();
  await messages.getByRole("link", { name: "Abrir a conversa da análise" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Globex Consultoria/Initech Bank - Backend" }),
  ).toBeVisible();
  const list = page.getByRole("list", { name: "Mensagens" });
  await expect(
    list.getByText("Análise da vaga Globex Consultoria/Initech Bank - Backend"),
  ).toBeVisible();
  await expect(list.getByText(/Análise gravada/)).toBeVisible();
});
