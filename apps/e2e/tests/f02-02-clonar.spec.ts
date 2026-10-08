import { expect, test } from "@playwright/test";
import { reset } from "../helpers/api";
import {
  gotoProfiles,
  listEmphasis,
  login,
  profileByName,
  profileItem,
  seed,
} from "../helpers/profiles";

test("F02/E2E-02 clonar: formulário pré-preenchido sem carreira, não salva sem ela, 'não sei' salva; ênfases iguais", async ({
  page,
}) => {
  await reset();
  const { ids } = await seed("engineer");
  await login(page);
  await gotoProfiles(page);
  await profileItem(page, "Eng. Software Sênior").getByRole("link", { name: "Clonar" }).click();
  await expect(page).toHaveURL(/\/perfis\/novo\?cloneFrom=/);
  await expect(page.getByRole("heading", { name: "Novo perfil" })).toBeVisible();
  await expect(page.locator("#clone-from")).toHaveValue(ids.profileId);
  await expect(page.locator("#pname")).toHaveValue("Cópia de Eng. Software Sênior");
  await expect(page.locator("#ptitle")).toHaveValue("Senior Backend Engineer");
  await expect(page.getByLabel("Mínimo")).toHaveValue("");

  await page.locator("#pname").fill("Staff Engineer");
  await page.locator("#ptitle").fill("Staff Engineer");
  await page.getByRole("button", { name: "Criar perfil", exact: true }).click();
  await expect(page.getByText("Preencha os campos obrigatórios para avançar.")).toBeVisible();
  await expect(page).toHaveURL(/\/perfis\/novo/);

  await page.getByLabel("Não sei").first().check();
  await page.getByLabel("CLT", { exact: true }).check();
  await page.getByRole("button", { name: "Criar perfil", exact: true }).click();
  await expect(page).toHaveURL(/\/perfis$/);
  await expect(profileItem(page, "Staff Engineer")).toBeVisible();

  const staff = await profileByName("Staff Engineer");
  expect(staff.clonedFrom).toBe(ids.profileId);
  expect(staff.needsResearch).toContain("salary");
  const key = (e: { kind: string; id: string; mode: string }) => `${e.kind}:${e.id}:${e.mode}`;
  const source = (await listEmphasis(ids.profileId)).items.map(key).sort();
  const cloned = (await listEmphasis(staff.id)).items.map(key).sort();
  expect(cloned).toEqual(source);
  expect(source.filter((k) => k.endsWith(":highlight"))).toHaveLength(2);
});
