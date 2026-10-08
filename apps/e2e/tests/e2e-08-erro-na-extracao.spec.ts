import { expect, test } from "@playwright/test";
import { reset, setMock } from "../helpers/api";
import { chooseFile, expectStep, openApp, passProvider, startExtraction } from "../helpers/flows";

/** O mock falha em `extractFacts`; a BullMQ tenta 2 vezes (backoff 5 s) antes de marcar a etapa como erro. */
async function failExtraction(page: Parameters<typeof openApp>[0]) {
  await reset();
  await setMock({ errors: { extractFacts: "falha simulada do modelo" } });
  await openApp(page);
  await passProvider(page);
  await chooseFile(page, "cv.docx");
  await startExtraction(page);
  await expect(
    page.getByText("A etapa “Extração de fatos” falhou: falha simulada do modelo"),
  ).toBeVisible({ timeout: 60_000 });
}

test.describe("F01/E2E-08 erro na extração", () => {
  test("F01/E2E-08 erro na extração: “continuar manual” leva à revisão em branco", async ({
    page,
  }) => {
    await failExtraction(page);
    await expect(page.getByRole("button", { name: "Tentar de novo a etapa" })).toBeVisible();
    await page.getByRole("button", { name: "Pular para preenchimento manual" }).click();
    await expectStep(page, 4);
    await expect(page.locator("#fullName")).toHaveValue("");
    await expect(page.locator('[data-testid^="proposal-"]')).toHaveCount(0);
  });

  test("F01/E2E-08 erro na extração: “tentar de novo” conclui quando o modelo volta", async ({
    page,
  }) => {
    await failExtraction(page);
    await setMock({ errors: {} });
    await page.getByRole("button", { name: "Tentar de novo a etapa" }).click();
    await expect(page.getByText("Extração concluída.")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Revisar o que foi extraído" }).click();
    await expectStep(page, 4);
    await expect(page.locator('[data-testid^="proposal-"]')).toHaveCount(15);
  });
});
