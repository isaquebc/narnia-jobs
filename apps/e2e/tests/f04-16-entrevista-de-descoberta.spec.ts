import { expect, test } from "@playwright/test";
import { onboarding, reset } from "../helpers/api";
import { expectDashboard, expectStep, reachProfileStep } from "../helpers/flows";

/**
 * Auditoria pós-F04 · bloco E2 (18a) · entrevista de descoberta no primeiro uso (02-fluxos passo 7): depois do perfil, o
 * recrutador olha as lacunas (fact_gaps), pergunta, e o relato vai para a revisão por ingest_text. O menu só ganha o
 * resto ao concluir.
 */
const ANSWER =
  "Na Acme Ltda eu liderei a migração do sistema de pagamentos para Go, com um time de cinco pessoas; reduzimos o tempo de aprovação de 900 ms para 250 ms e a taxa de erro caiu pela metade em seis meses. Saí em março de 2023 para a Beta.";

test("F04/E2E-16 entrevista de descoberta: lacunas, resposta para a revisão e primeiro uso concluído ao sair", async ({
  page,
}) => {
  await reset();
  await reachProfileStep(page, "cv_text.pdf");
  await page.getByLabel("Mínimo").fill("9000");
  await page.getByLabel("Máximo").fill("12000");
  await page.getByLabel("CLT", { exact: true }).check();
  await page.getByRole("button", { name: "Criar perfil e continuar" }).click();

  await expectStep(page, 6);
  await expect(page.getByRole("heading", { name: "Entrevista de descoberta" })).toBeVisible();
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
  expect((await onboarding()).completed).toBe(false);

  await page.getByRole("button", { name: "Começar entrevista" }).click();
  const list = page.getByRole("list", { name: "Mensagens" });
  await expect(list.getByText("Vamos começar a entrevista de descoberta.")).toBeVisible();
  await expect(list.getByText(/fonte: fact_gaps/)).toBeVisible();
  await expect(list.getByText("fact_gaps").first()).toBeVisible();

  await page.getByRole("textbox", { name: "Mensagem para o recrutador" }).fill(ANSWER);
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(list.getByText(/propostas estão na revisão/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Abrir a ingestão criada/ })).toBeVisible();

  // recarregar no passo 6 retoma a mesma conversa
  await page.reload();
  await expect(
    page.getByRole("list", { name: "Mensagens" }).getByText(/fonte: fact_gaps/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Concluir e ir ao dashboard" }).click();
  await expectDashboard(page);
  expect((await onboarding()).completed).toBe(true);
  await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
});
