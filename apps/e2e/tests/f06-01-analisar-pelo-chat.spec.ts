import { expect, test } from "@playwright/test";
import { freshStart } from "../helpers/ingest";
import { JD, listPostings } from "../helpers/postings";
import { login } from "../helpers/profiles";

test("F06/E2E-01 analisar pelo chat: a vaga é salva, a conversa 'contratante/cliente - role' abre e a análise aparece na página da vaga", async ({
  page,
}) => {
  await freshStart("engineer");
  await login(page);
  const nav = page.getByRole("navigation");
  await nav.getByRole("group", { name: "Geral" }).getByRole("link", { name: /^Chat/ }).click();
  await page.getByRole("button", { name: "Nova conversa" }).click();
  const box = page.getByRole("textbox", { name: "Mensagem para o recrutador" });
  await box.fill(`analisa esta vaga: ${JD}`);
  await page.getByRole("button", { name: "Enviar" }).click();
  const messages = page.getByRole("list", { name: "Mensagens" });
  await messages.getByRole("link", { name: "Abrir a conversa da análise" }).click();
  // conversa nova com o título da vaga, já rodando a análise (o mock percorre a skill)
  await expect(
    page.getByRole("heading", { level: 2, name: "Globex Consultoria/Initech Bank - Backend" }),
  ).toBeVisible();
  const list = page.getByRole("list", { name: "Mensagens" });
  await expect(
    list.getByText("Análise da vaga Globex Consultoria/Initech Bank - Backend"),
  ).toBeVisible();
  await expect(list.getByText(/Análise gravada/)).toBeVisible();
  await expect(list.getByRole("button", { name: "Criar CV para esta vaga" })).toBeDisabled();
  // menu de conversas agrupado: a da vaga fica em "Vaga"
  await expect(
    nav
      .getByRole("list", { name: "Vaga" })
      .getByRole("link", { name: /Globex Consultoria\/Initech Bank - Backend/ }),
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
