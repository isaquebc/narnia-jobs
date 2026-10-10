import { expect, test } from "@playwright/test";
import { fixture } from "../helpers/flows";
import { finishByRejecting, freshStart, openIngestion, waitRun } from "../helpers/ingest";

const STORY =
  "Comecei como estagiária de suporte em 2014 numa empresa de logística, onde aprendi SQL resolvendo chamados. " +
  "Em 2016 virei desenvolvedora backend na Acme Pagamentos, cuidando da API de cobranças em Node.js e PostgreSQL. " +
  "Liderei a migração para filas com RabbitMQ, que reduziu o tempo de conciliação de horas para minutos. " +
  "Hoje sou engenheira sênior e mentoro duas pessoas do time.";

test("F03/E2E-06 já lido: o mesmo CV e o mesmo texto avisam e apontam a execução anterior", async ({
  page,
}) => {
  await freshStart("engineer");
  await openIngestion(page);
  await page.getByRole("tab", { name: "Currículo" }).click();
  await page.locator('input[type="file"]').setInputFiles(fixture("cv_text.pdf"));
  await expect(page).toHaveURL(/\/ingestao\/[\w-]+$/, { timeout: 30_000 });
  const first = page.url().split("/").pop() as string;
  await waitRun(first, ["review"], 120_000);
  await finishByRejecting(first);

  await page.goto("/ingestao");
  await page.getByRole("tab", { name: "Currículo" }).click();
  await page.locator('input[type="file"]').setInputFiles(fixture("cv_text.pdf"));
  await expect(page.getByText(/Este conteúdo já foi lido em/)).toBeVisible();
  await page.getByRole("link", { name: "Abrir execução anterior" }).click();
  await expect(page).toHaveURL(new RegExp(`/ingestao/${first}$`));

  // texto livre: mesma regra, por hash do texto
  await page.goto("/ingestao");
  await page.getByRole("tab", { name: "Texto livre" }).click();
  await page
    .getByRole("textbox", { name: "Conte a sua história de carreira e de vida" })
    .fill(STORY);
  await page.getByRole("button", { name: "Calcular estimativa" }).click();
  await expect(page).toHaveURL(/\/ingestao\/[\w-]+$/, { timeout: 30_000 });
  const text = page.url().split("/").pop() as string;
  await waitRun(text, ["review"], 120_000);
  await page.goto("/ingestao");
  await page.getByRole("tab", { name: "Texto livre" }).click();
  await page
    .getByRole("textbox", { name: "Conte a sua história de carreira e de vida" })
    .fill(STORY);
  await page.getByRole("button", { name: "Calcular estimativa" }).click();
  await expect(page.getByText(/Este conteúdo já foi lido em/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Ler de novo" })).toBeVisible();
});
