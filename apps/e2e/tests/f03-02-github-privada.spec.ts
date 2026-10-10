import { expect, test } from "@playwright/test";
import {
  acceptAllAndSave,
  freshStart,
  getRun,
  openIngestion,
  selectOnly,
  waitRun,
} from "../helpers/ingest";

test("F03/E2E-02 GitHub privada: privados com cadeado, aviso acima de 10, métricas e plano", async ({
  page,
}) => {
  await freshStart("engineer");
  await openIngestion(page);
  await expect(page.getByText("Conectado como @ana-exemplo")).toBeVisible();

  await page.getByRole("radio", { name: "Análise privada" }).check();
  await page.getByRole("button", { name: "Listar repositórios" }).click();
  const personal = page.getByRole("group", { name: "Pessoais" });
  await expect(personal).toBeVisible();
  await expect(personal.getByText("privado", { exact: true })).toBeVisible();
  // pré-seleção: até 10 por grupo, forks e arquivados de fora; o total passa de 10 e o aviso aparece
  await expect(personal.getByText(/^\d+ de 12$/)).toBeVisible();
  await expect(page.getByText(/Você selecionou \d+ repositórios\. Acima de 10/)).toBeVisible();
  await personal.getByRole("checkbox", { name: "ana-exemplo/react", exact: true }).check();
  await expect(
    personal.getByRole("checkbox", { name: "ana-exemplo/react", exact: true }),
  ).toBeChecked();

  // execução curta: dois repositórios, um deles privado
  await selectOnly(page, ["ana-exemplo/api-pagamentos", "ana-exemplo/notas-privadas"]);
  await expect(page.getByText(/Você selecionou/)).toHaveCount(0);
  const plan = page.getByRole("region", { name: "Seu plano" });
  await expect(plan).toBeVisible();
  await page.getByRole("button", { name: "Iniciar análise" }).click();
  await expect(page).toHaveURL(/\/ingestao\/[\w-]+$/);
  const runId = page.url().split("/").pop() as string;
  await page.getByRole("button", { name: "Confirmar e iniciar" }).click();
  await waitRun(runId, ["review"]);
  await acceptAllAndSave(page);
  await waitRun(runId, ["done"]);
  const run = await getRun(runId);
  expect(run.report?.repos.map((r) => r.fullName).sort()).toEqual([
    "ana-exemplo/api-pagamentos",
    "ana-exemplo/notas-privadas",
  ]);

  await page.goto("/evidencias/repositorios");
  await page
    .getByRole("listitem", { name: "ana-exemplo/api-pagamentos" })
    .getByRole("link", { name: "Ver detalhes" })
    .click();
  await expect(page.getByRole("region", { name: "Métricas" })).toBeVisible();
});
