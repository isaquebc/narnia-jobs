import { expect, test } from "@playwright/test";
import { reset } from "../helpers/api";
import { createPm, dashboardFull, getCard, login, patchFact, seed } from "../helpers/profiles";

test("F02/E2E-04 invalidação: alterar um fato desatualiza os dois cartões (WS) e cada um reconstrói com nova data", async ({
  page,
}) => {
  await reset();
  const { ids } = await seed("engineer");
  await login(page);
  const pm = await createPm(page);
  const pmBefore = await getCard(pm.id);

  await page.goto(`/perfis/${ids.profileId}/cartao`);
  await expect(page.getByText("Atualizado", { exact: true })).toBeVisible();
  const engBefore = await getCard(ids.profileId);
  await expect(page.getByText(/Atualizado em /)).toBeVisible();

  await patchFact("experience", ids.experienceIds[0] as string, { title: "Engenheira Principal" });

  // a página do cartão recebe profile.card_invalidated e recarrega: novo texto, nova data
  await expect(page.getByText(/Engenheira Principal/).first()).toBeVisible({ timeout: 15_000 });
  const engAfter = await getCard(ids.profileId);
  expect(engAfter.builtAt > engBefore.builtAt).toBe(true);
  expect(engAfter.text).toContain("Engenheira Principal");

  // o PM (inativo) também ficou inválido: abrir o cartão reconstrói com data nova
  await page.goto(`/perfis/${pm.id}/cartao`);
  await expect(page.getByText(/Engenheira Principal/).first()).toBeVisible();
  await expect(page.getByText("Atualizado", { exact: true })).toBeVisible();
  const pmAfter = await getCard(pm.id);
  expect(pmAfter.builtAt > pmBefore.builtAt).toBe(true);
  expect((await dashboardFull()).card?.valid).toBe(true);
});
