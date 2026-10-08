import { expect, test } from "@playwright/test";
import { dashboard, ingestion, onboarding, reset } from "../helpers/api";
import {
  chooseFile,
  expectStep,
  fillProfileAndCreate,
  openApp,
  passProvider,
  startExtraction,
  statValue,
  waitExtractionDone,
} from "../helpers/flows";

test("F01/E2E-07 rejeitar uma experiência e editar o título de outra: dashboard e banco refletem", async ({
  page,
}) => {
  await reset();
  await openApp(page);
  await passProvider(page);
  await chooseFile(page, "cv_text.pdf");
  await startExtraction(page);
  await waitExtractionDone(page);

  const acme = page.locator('[data-testid^="proposal-"]', { hasText: "Acme Ltda" });
  const globex = page.locator('[data-testid^="proposal-"]', { hasText: "Globex S.A." });
  await globex.getByRole("button", { name: "Rejeitar" }).click();
  await expect(globex.getByText("Rejeitar", { exact: true }).first()).toBeVisible();

  await acme.getByRole("button", { name: "Editar" }).click();
  const dialog = page.getByRole("dialog", { name: "Editar item" });
  await dialog.getByLabel("title", { exact: true }).fill("Staff Engineer");
  await dialog.getByRole("button", { name: "Salvar edição" }).click();
  await expect(acme.getByText("Staff Engineer", { exact: false })).toBeVisible();
  await expect(acme.getByText("editado")).toBeVisible();

  await page.getByRole("button", { name: "Aceitar todos" }).click();
  await page.getByRole("button", { name: "Avançar" }).click();
  await expectStep(page, 5);

  const runId = (await onboarding()).runId as string;
  const run = await ingestion(runId);
  const experiences = run.proposals.filter((p) => p.proposal.kind === "experience");
  expect(experiences).toHaveLength(2);
  const edited = experiences.find((p) => p.decision === "edited");
  expect(edited?.editedData?.title).toBe("Staff Engineer");
  expect(experiences.some((p) => p.decision === "rejected")).toBe(true);

  await fillProfileAndCreate(page);
  expect(await statValue(page, "experiences")).toBe(1);
  expect((await dashboard()).counts.experiences).toBe(1);
});
