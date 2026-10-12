import { expect, test } from "@playwright/test";
import { profiles, reset, salaryReference } from "../helpers/api";
import { reachProfileStep, submitProfileAndSkipDiscovery } from "../helpers/flows";

test.describe("F01/E2E-16 alerta DIEESE", () => {
  test("F01/E2E-16 alerta DIEESE: BRL mensal abaixo da referência mostra o alerta e salva o valor informado", async ({
    page,
  }) => {
    await reset();
    const ref = (await salaryReference("BR")).reference;
    expect(ref).not.toBeNull();
    await reachProfileStep(page, "cv_text.pdf");
    await page.getByLabel("Mínimo").fill("6000");
    await page.getByLabel("Máximo").fill("9000");
    const alert = page.getByText(
      /Abaixo do salário mínimo necessário do DIEESE de 09\/2026: R\$\s?7\.300/,
    );
    await expect(alert).toBeVisible();
    await expect(page.getByRole("link", { name: "Fonte" })).toHaveAttribute("href", /dieese/);
    await page.getByLabel("CLT", { exact: true }).check();
    await submitProfileAndSkipDiscovery(page);
    const [profile] = (await profiles()).profiles;
    expect(profile?.salaryBelowReference).toBe(true);
    expect(profile?.salary).toMatchObject({
      min: 6000,
      max: 9000,
      currency: "BRL",
      period: "monthly",
    });
  });

  test("F01/E2E-16 alerta DIEESE: mesmo valor em USD não dispara o alerta", async ({ page }) => {
    await reset();
    await reachProfileStep(page, "cv_text.pdf");
    await page.getByLabel("Mínimo").fill("6000");
    await page.getByLabel("Máximo").fill("9000");
    await page.getByLabel("Moeda").selectOption("USD");
    await expect(page.getByText(/Abaixo do salário mínimo necessário/)).toHaveCount(0);
    await page.getByLabel("CLT", { exact: true }).check();
    await submitProfileAndSkipDiscovery(page);
    const [profile] = (await profiles()).profiles;
    expect(profile?.salaryBelowReference).toBe(false);
    expect(profile?.salary).toMatchObject({ min: 6000, currency: "USD" });
  });
});
