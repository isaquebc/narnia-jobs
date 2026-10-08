import { expect, test } from "@playwright/test";
import { reset } from "../helpers/api";
import { createPm, login, seed, switcher, switchTo } from "../helpers/profiles";

test("F02/E2E-08 duas abas: trocar o perfil na aba A atualiza seletor e dashboard da aba B pelo WebSocket", async ({
  page,
  context,
}) => {
  await reset();
  await seed("engineer");
  await login(page);
  await createPm(page);

  const tabB = await context.newPage();
  await tabB.goto("/dashboard");
  await expect(tabB.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(switcher(tabB)).toContainText("Eng. Software Sênior");
  await expect(tabB.getByText("2 em destaque · 0 ocultos")).toBeVisible();

  await switchTo(page, "Project Manager");

  await expect(switcher(tabB)).toContainText("Project Manager", { timeout: 15_000 });
  await expect(tabB.getByText("0 em destaque · 0 ocultos")).toBeVisible({ timeout: 15_000 });
  await expect(tabB.getByText("Project Manager").first()).toBeVisible();
  await tabB.close();
});
