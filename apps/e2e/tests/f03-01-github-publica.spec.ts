import { expect, test } from "@playwright/test";
import {
  acceptAllAndSave,
  freshStart,
  getRun,
  openIngestion,
  selectOnly,
  setGithub,
  waitRun,
} from "../helpers/ingest";

test("F03/E2E-01 GitHub pública rápida: grupos, pré-seleção, estimativa, revisão e Evidências com digest", async ({
  page,
}) => {
  await freshStart("engineer");
  await setGithub({ authenticated: false });
  await openIngestion(page);

  await page.getByRole("radio", { name: "Análise pública" }).check();
  await page.getByLabel("Usuário do GitHub").fill("ana-exemplo");
  await page.getByRole("button", { name: "Listar repositórios" }).click();

  const personal = page.getByRole("group", { name: "Pessoais" });
  await expect(personal).toBeVisible();
  // pública: sem privados; forks e arquivados aparecem desmarcados e destacados
  await expect(page.getByText("privado", { exact: true })).toHaveCount(0);
  await expect(personal.getByRole("checkbox", { name: "ana-exemplo/react" })).not.toBeChecked();
  await expect(personal.locator("li[data-variant=special]")).toHaveCount(3);
  // organização recolhida; ao expandir mostra os repositórios com link
  const org = page.getByRole("group", { name: "acme-labs" });
  await org.getByRole("button", { expanded: false }).click();
  await expect(
    org.getByRole("link", { name: /Abrir acme-labs\/plataforma-core no GitHub/ }),
  ).toBeVisible();

  // deixa só dois repositórios pessoais para a execução ficar curta
  await selectOnly(page, ["ana-exemplo/api-pagamentos", "ana-exemplo/painel-web"]);
  await expect(page.getByText("2 repositórios selecionados")).toBeVisible();

  await page.getByRole("radio", { name: "Rápida" }).check();
  const estimate = page.getByRole("region", { name: "Estimativa" });
  await expect(estimate.getByText(/~[\d.,]+k? tokens/).first()).toBeVisible();
  await expect(estimate.getByText(/Recomendado:/)).toBeVisible();

  await page.getByRole("button", { name: "Iniciar análise" }).click();
  await expect(page).toHaveURL(/\/ingestao\/[\w-]+$/);
  const runId = page.url().split("/").pop() as string;
  await page.getByRole("button", { name: "Confirmar e iniciar" }).click();
  await waitRun(runId, ["review"]);

  const review = page.getByRole("region", { name: "Revisão" });
  await expect(review.getByText("Novo").first()).toBeVisible({ timeout: 30_000 });
  await acceptAllAndSave(page);
  await waitRun(runId, ["done"]);
  const run = await getRun(runId);
  expect(run.proposals.some((p) => p.proposal.kind === "project")).toBe(true);
  expect(run.proposals.some((p) => p.proposal.kind === "skill")).toBe(true);
  await expect(page.getByRole("region", { name: "Relatório da execução" })).toBeVisible();

  await page.goto("/evidencias/repositorios");
  const item = page.getByRole("listitem", { name: "ana-exemplo/api-pagamentos" });
  await expect(item).toBeVisible();
  await item.getByRole("link", { name: "Ver detalhes" }).click();
  await expect(page.getByRole("region", { name: "Resumo do repositório" })).toBeVisible();
  // análise pública sem login: a API de métricas (GraphQL) exige autenticação, então a seção não aparece
  await expect(page.getByRole("region", { name: "Métricas" })).toHaveCount(0);
});
