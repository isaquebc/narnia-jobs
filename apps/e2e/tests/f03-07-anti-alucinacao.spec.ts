import { expect, test } from "@playwright/test";
import { fixture } from "../helpers/flows";
import { freshStart, getRun, openIngestion, setMockF03, waitRun } from "../helpers/ingest";

test("F03/E2E-07 revisão anti-alucinação: trecho inexistente vira 'Sem suporte' e ainda pode ser aceito", async ({
  page,
}) => {
  await freshStart("engineer");
  await setMockF03({ unsupportedEvidence: true });
  await openIngestion(page);
  await page.getByRole("tab", { name: "Currículo" }).click();
  await page.locator('input[type="file"]').setInputFiles(fixture("cv_text.pdf"));
  await expect(page).toHaveURL(/\/ingestao\/[\w-]+$/, { timeout: 30_000 });
  const runId = page.url().split("/").pop() as string;
  await waitRun(runId, ["review"], 120_000);
  const run = await getRun(runId);
  const unsupported = run.proposals.filter((p) => p.checkStatus === "unsupported");
  // só a proposta com o trecho inventado; as demais citam o currículo de verdade
  expect(unsupported).toHaveLength(1);

  const review = page.getByRole("region", { name: "Revisão" });
  await review.getByRole("radio", { name: "Sem suporte (1)" }).check();
  const row = review.getByRole("listitem").filter({ hasText: "Sem suporte" });
  await expect(row).toHaveCount(1);
  await row.getByText("Ver trecho").click();
  await row.getByRole("button", { name: "Aceitar" }).click();
  await expect(row.getByRole("button", { name: "Desfazer" })).toBeVisible();
  await expect(review.getByRole("button", { name: "Clarificar com o recrutador" })).toBeDisabled();
});
