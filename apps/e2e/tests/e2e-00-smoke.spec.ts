import { expect, test } from "@playwright/test";
import { api, reset } from "../helpers/api";

/** Fumaça da ligação: stack e2e no ar, reset disponível e SPA servida pelo nginx. */
test("F01/E2E-00 stack e2e responde e serve a interface", async ({ page }) => {
  await reset();
  const health = await api<{ ok: boolean }>("/api/health");
  expect(health.ok).toBe(true);
  await page.goto("/?token=e2e-token");
  await expect(page).toHaveTitle(/narnia-jobs/);
});
