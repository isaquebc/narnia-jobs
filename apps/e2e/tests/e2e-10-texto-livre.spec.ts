import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { dashboard, reset } from "../helpers/api";
import {
  acceptAllAndNext,
  expectStep,
  fillProfileAndCreate,
  fixture,
  openApp,
  passProvider,
  statValue,
  waitExtractionDone,
} from "../helpers/flows";

test("F01/E2E-10 texto livre: colar o relato, extrair, revisar e concluir", async ({ page }) => {
  await reset();
  await openApp(page);
  await passProvider(page);
  await page.getByRole("tab", { name: "Texto livre" }).click();
  const text = readFileSync(fixture("texto_livre.txt"), "utf8");
  expect(text.length).toBeGreaterThan(200);
  const extract = page.getByRole("button", { name: "Extrair", exact: true });
  await expect(extract).toBeDisabled();
  await page.getByRole("textbox", { name: "Texto livre" }).fill(text);
  await expect(page.getByText("Rascunho salvo neste navegador.")).toBeVisible();
  await expect(extract).toBeEnabled();
  await extract.click();
  await expectStep(page, 3);
  await expect(page.getByText("OCR das páginas")).toHaveCount(0);
  await waitExtractionDone(page);
  await expect(page.locator('[data-testid^="proposal-"]')).toHaveCount(15);
  await acceptAllAndNext(page);
  await fillProfileAndCreate(page);
  expect(await statValue(page, "files")).toBe(1);
  expect((await dashboard()).counts.experiences).toBe(2);
});
