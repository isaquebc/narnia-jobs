import { expect, test } from "@playwright/test";
import { reset } from "../helpers/api";
import {
  fillNewProfileAndCreate,
  gotoProfiles,
  listSuggestions,
  login,
  seed,
} from "../helpers/profiles";

test("F02/E2E-06 sugestão heurística: banner no dashboard, aceitar pré-preenche e cria, banner some; dispensar não volta", async ({
  page,
}) => {
  await reset();
  await seed("leader");
  await login(page);
  const banner = page.getByText(/Detectamos um possível perfil de (.+)\./);
  await expect(banner).toBeVisible();
  const title = ((await banner.textContent()) ?? "").replace(
    /^Detectamos um possível perfil de (.+)\.$/,
    "$1",
  );
  expect(title.length).toBeGreaterThan(0);

  await page.getByRole("link", { name: "Aceitar" }).click();
  await expect(page).toHaveURL(/\/perfis\/novo\?.*suggestionId=/);
  await expect(page.getByText(`Pré-preenchido a partir da sugestão “${title}”.`)).toBeVisible();
  await expect(page.locator("#ptitle")).toHaveValue(title);
  await fillNewProfileAndCreate(page, { name: title });

  const remaining = (await listSuggestions()).suggestions;
  expect(remaining.map((s) => s.payload.title)).not.toContain(title);
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByText(`Detectamos um possível perfil de ${title}.`)).toHaveCount(0);

  // dispensar outra na lista de perfis; não volta após recarregar
  expect(remaining.length).toBeGreaterThan(0);
  const other = remaining[0] as { payload: { title: string } };
  await gotoProfiles(page);
  const section = page.getByRole("region", { name: "Sugestões de perfil" });
  await expect(section.getByText(other.payload.title).first()).toBeVisible();
  await section.getByRole("button", { name: "Dispensar" }).first().click();
  await expect(section.getByText(other.payload.title)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Perfis", exact: true })).toBeVisible();
  await expect(section.getByText(other.payload.title)).toHaveCount(0);
  expect((await listSuggestions()).suggestions.map((s) => s.payload.title)).not.toContain(
    other.payload.title,
  );
});
