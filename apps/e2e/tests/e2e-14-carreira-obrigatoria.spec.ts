import { expect, test } from "@playwright/test";
import { dashboard, profiles, reset, salaryReference } from "../helpers/api";
import { expectDashboard, fillProfileAndCreate, reachProfileStep } from "../helpers/flows";

test("F01/E2E-14 dados de carreira obrigatórios: sem faixa salarial bloqueia; “não sei” avança com provisório DIEESE", async ({
  page,
}) => {
  await reset();
  await reachProfileStep(page, "cv_text.pdf");
  await fillProfileAndCreate(page, { salary: "skip" });
  await expect(
    page.getByText(/Preencha os campos obrigatórios para avançar\. .*Faixa salarial pretendida/),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding\/5$/);

  await page.getByLabel("Não sei").first().check();
  await expect(page.getByText("Marcado para pesquisar com o recrutador")).toBeVisible();
  await expect(page.getByLabel("Mínimo")).toBeDisabled();
  await page.getByRole("button", { name: "Criar perfil e ir ao dashboard" }).click();
  await expectDashboard(page);
  await expect(page.getByText("1 itens para resolver com o recrutador")).toBeVisible();

  const ref = (await salaryReference("BR")).reference;
  expect(ref?.currency).toBe("BRL");
  const [profile] = (await profiles()).profiles;
  expect(profile?.needsResearch).toEqual(["salary"]);
  expect(profile?.salary).toMatchObject({ min: ref?.value, currency: "BRL", period: "monthly" });
  expect((await dashboard()).pendingResearch).toBe(1);
});
