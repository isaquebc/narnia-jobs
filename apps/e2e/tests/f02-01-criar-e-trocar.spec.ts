import { expect, test } from "@playwright/test";
import { reset } from "../helpers/api";
import {
  createPm,
  dashboardFull,
  getCard,
  login,
  profileItem,
  seed,
  switcher,
  switchTo,
} from "../helpers/profiles";

test("F02/E2E-01 criar e trocar: segundo perfil do zero, seletor com 2, ativar e dashboard muda; recarregar mantém", async ({
  page,
}) => {
  await reset();
  await seed("engineer");
  await login(page);
  await expect(switcher(page)).toContainText("Eng. Software Sênior");
  const before = await dashboardFull();
  expect(before.emphasis).toEqual({ highlighted: 2, hidden: 0 });

  const pm = await createPm(page);
  expect(pm.isActive).toBe(false);
  await expect(
    profileItem(page, "Eng. Software Sênior").getByText("ativo", { exact: true }),
  ).toBeVisible();

  await switcher(page).click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(2);
  await page.getByRole("menuitemradio", { name: /Project Manager/ }).click();
  await expect(switcher(page)).toContainText("Project Manager");

  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Project Manager").first()).toBeVisible();
  await expect(page.getByText("0 em destaque · 0 ocultos")).toBeVisible();
  const after = await dashboardFull();
  expect(after.profile?.name).toBe("Project Manager");
  expect(after.card?.text).toContain("Ana Maria Exemplo");
  expect((await getCard(pm.id)).text).toContain("Project Manager");

  await page.reload();
  await expect(switcher(page)).toContainText("Project Manager");
  await switchTo(page, "Eng. Software Sênior");
  expect((await dashboardFull()).profile?.name).toBe("Eng. Software Sênior");
});
