import { expect, test } from "@playwright/test";
import { dashboard, reset } from "../helpers/api";
import {
  expectStep,
  fillIdentityBlank,
  fillProfileAndCreate,
  openApp,
  passProvider,
  statValue,
} from "../helpers/flows";

test("F01/E2E-02 sem CV: começar do zero, identidade e perfil manuais, dashboard vazio", async ({
  page,
}) => {
  await reset();
  await openApp(page);
  await passProvider(page);
  await page.getByRole("button", { name: "Não tenho, começar do zero" }).click();
  await expectStep(page, 4);

  await expect(page.locator("#fullName")).toHaveValue("");
  await expect(page.locator('[data-testid^="proposal-"]')).toHaveCount(0);
  await fillIdentityBlank(page);
  await page.getByRole("button", { name: "Avançar" }).click();
  await expectStep(page, 5);

  await expect(page.getByText("Sem currículo não há sugestão; preencha à mão.")).toBeVisible();
  await fillProfileAndCreate(page, {
    name: "Analista de dados",
    title: "Analista de Dados",
    area: "dados",
  });
  await expect(page.getByText("Olá, Bia")).toBeVisible();
  for (const k of ["experiences", "skills", "education", "files"] as const) {
    expect(await statValue(page, k)).toBe(0);
  }
  expect((await dashboard()).profile?.id).toBeTruthy();
});
