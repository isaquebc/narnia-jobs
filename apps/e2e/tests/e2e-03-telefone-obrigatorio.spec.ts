import { expect, test } from "@playwright/test";
import { reset, user } from "../helpers/api";
import { expectStep, fillIdentityBlank, fillPhone, openApp, passProvider } from "../helpers/flows";

test("F01/E2E-03 telefone obrigatório: sem telefone e DDD inválido bloqueiam; válido avança", async ({
  page,
}) => {
  await reset();
  await openApp(page);
  await passProvider(page);
  await page.getByRole("button", { name: "Não tenho, começar do zero" }).click();
  await expectStep(page, 4);
  await fillIdentityBlank(page, { phone: false });

  const next = page.getByRole("button", { name: "Avançar" });
  await next.click();
  await expect(page.getByText("Preencha os campos obrigatórios para avançar.")).toBeVisible();
  await expect(page.getByText("DDD inválido.")).toBeVisible();
  await expectStep(page, 4);

  await fillPhone(page, "1", "987654321");
  await next.click();
  await expect(page.getByText("DDD inválido.")).toBeVisible();
  await expectStep(page, 4);

  await fillPhone(page, "41", "987654321");
  await next.click();
  await expectStep(page, 5);
  expect((await user()).user?.phone.e164).toBe("+5541987654321");
});
