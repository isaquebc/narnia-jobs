import { expect, test } from "@playwright/test";
import { onboarding, reset } from "../helpers/api";
import {
  chooseFile,
  expectStep,
  openApp,
  passProvider,
  startExtraction,
  waitExtractionDone,
} from "../helpers/flows";

test("F01/E2E-05 retomada: fechar no passo 4 e reabrir volta ao passo 4 com as propostas intactas", async ({
  browser,
}) => {
  await reset();
  const first = await browser.newContext();
  const page = await first.newPage();
  await openApp(page);
  await passProvider(page);
  await chooseFile(page, "cv_text.pdf");
  await startExtraction(page);
  await waitExtractionDone(page);
  await expect(page.locator('[data-testid^="proposal-"]')).toHaveCount(15);
  await page
    .locator('[data-testid^="proposal-"]')
    .first()
    .getByRole("button", { name: "Aceitar" })
    .click();
  await first.close();

  expect((await onboarding()).step).toBe(4);
  const second = await browser.newContext();
  const again = await second.newPage();
  await openApp(again);
  await expectStep(again, 4);
  await expect(again.locator('[data-testid^="proposal-"]')).toHaveCount(15);
  await expect(again.getByText("15 pendentes")).toBeVisible();
  await expect(again.locator("#fullName")).toHaveValue("Ana Maria Exemplo");
  await second.close();
});
