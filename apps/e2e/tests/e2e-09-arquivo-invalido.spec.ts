import { expect, test } from "@playwright/test";
import { dashboard, reset } from "../helpers/api";
import { fixture, openApp, passProvider } from "../helpers/flows";

test("F01/E2E-09 arquivo inválido: executável renomeado para .pdf é recusado com mensagem", async ({
  page,
}) => {
  await reset();
  await openApp(page);
  await passProvider(page);
  await page.locator('input[type="file"]').setInputFiles(fixture("fake.pdf"));
  await expect(page.getByText("Dados inválidos. Revise os campos destacados.")).toBeVisible();
  await expect(page.getByText(/Tipo de arquivo não suportado/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Extrair", exact: true })).toBeDisabled();
  expect((await dashboard()).counts.files).toBe(0);
});
