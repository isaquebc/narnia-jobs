import { expect, test } from "@playwright/test";
import { reset } from "../helpers/api";
import {
  createPm,
  gotoProfiles,
  listProfiles,
  login,
  profileItem,
  seed,
  switcher,
} from "../helpers/profiles";

test("F02/E2E-05 arquivar: ativo bloqueado, trocar e arquivar some do seletor, mostrar arquivados, desarquivar", async ({
  page,
}) => {
  await reset();
  await seed("engineer");
  await login(page);
  await createPm(page);
  await gotoProfiles(page);
  const eng = profileItem(page, "Eng. Software Sênior");
  const pm = profileItem(page, "Project Manager");

  await eng.getByRole("button", { name: "Arquivar" }).click();
  await expect(
    page.getByText("O perfil ativo não pode ser arquivado. Troque de perfil antes."),
  ).toBeVisible();

  await pm.getByRole("button", { name: "Ativar" }).click();
  await expect(pm.getByText("ativo", { exact: true })).toBeVisible();
  await eng.getByRole("button", { name: "Arquivar" }).click();
  await expect(eng).toHaveCount(0);

  await switcher(page).click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(1);
  await page.getByRole("menuitemradio", { name: /Project Manager/ }).click();
  expect((await listProfiles()).profiles.map((p) => p.name)).toEqual(["Project Manager"]);

  await page.getByLabel("Mostrar arquivados").check();
  await expect(eng).toBeVisible();
  await expect(eng.getByText("arquivado", { exact: true })).toBeVisible();
  await eng.getByRole("button", { name: "Desarquivar" }).click();
  await expect(eng.getByText("arquivado", { exact: true })).toHaveCount(0);
  expect((await listProfiles()).profiles.map((p) => p.name).sort()).toEqual([
    "Eng. Software Sênior",
    "Project Manager",
  ]);
});
