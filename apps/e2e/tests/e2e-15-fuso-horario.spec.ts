import { expect, test } from "@playwright/test";
import { formatInTz, profiles, reset, user } from "../helpers/api";
import { fillProfileAndCreate, reachProfileStep } from "../helpers/flows";

/**
 * Desvio do §6.3: em F01 nenhuma tela mostra a hora do upload; a data visível é a do perfil ("Atualizado em"),
 * gravada em UTC e exibida no fuso do usuário. A comparação é feita contra o instante UTC devolvido pela API.
 */
test("F01/E2E-15 fuso horário: instante UTC da API aparece convertido para America/Sao_Paulo", async ({
  page,
}) => {
  await reset();
  await reachProfileStep(page, "cv_text.pdf");
  await page.locator("#timezone").waitFor({ state: "detached" });
  expect((await user()).user?.timezone).toBe("America/Sao_Paulo");
  await fillProfileAndCreate(page);

  const [profile] = (await profiles()).profiles;
  const utc = profile?.updatedAt ?? profile?.createdAt;
  expect(utc).toMatch(/Z$/);
  const local = formatInTz(utc as string, "America/Sao_Paulo");
  const asUtc = formatInTz(utc as string, "UTC");
  expect(local).not.toBe(asUtc);
  await expect(page.getByText(`Atualizado em ${local}`)).toBeVisible();
  await expect(page.getByText("Fuso horário: America/Sao_Paulo")).toBeVisible();
});
