import { expect, test } from "@playwright/test";
import { jobs, reset, waitFor } from "../helpers/api";
import { gotoProfiles, listSuggestions, login, seed } from "../helpers/profiles";

test("F02/E2E-07 análise pelo modelo (mock): alerta com estimativa e modelo, job, sugestões com justificativa, dispensar e aceitar", async ({
  page,
}) => {
  await reset();
  await seed("engineer");
  await login(page);
  await gotoProfiles(page);
  const section = page.getByRole("region", { name: "Sugestões de perfil" });
  await expect(section.getByText("Nenhuma sugestão nova.")).toBeVisible();

  await page.getByRole("button", { name: "Analisar possíveis perfis" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Operação cara/)).toBeVisible();
  await expect(dialog.getByText(/Estimativa: ~.+ tokens com sonnet/)).toBeVisible();
  await expect(dialog.locator("#analyze-model")).toHaveValue("sonnet");
  await dialog.getByRole("button", { name: "Confirmar e analisar" }).click();
  await expect(page.getByText(/Análise iniciada/)).toBeVisible();

  const done = await waitFor(
    jobs,
    (j) => j.jobs.some((x) => x.id.startsWith("task__profile.analyze__") && x.status === "done"),
    { timeoutMs: 60_000, label: "job profile.analyze concluído" },
  );
  expect(done.jobs.find((x) => x.id.startsWith("task__profile.analyze__"))?.stage).toBe(
    "profile.analyze",
  );

  await expect(section.getByText("Modelo (sonnet)")).toHaveCount(2, { timeout: 15_000 });
  await expect(section.getByText("Por quê").first()).toBeVisible();
  await expect(section.getByText(/\d+ fatos de apoio/).first()).toBeVisible();
  const titles = (await listSuggestions()).suggestions.map((s) => s.payload.title).sort();
  expect(titles).toEqual(["Engineering Manager", "Staff Engineer"]);

  await section.getByRole("button", { name: "Dispensar" }).first().click();
  await expect(section.getByText("Modelo (sonnet)")).toHaveCount(1);
  const left = (await listSuggestions()).suggestions;
  expect(left).toHaveLength(1);
  await section.getByRole("link", { name: "Aceitar" }).click();
  await expect(page).toHaveURL(/\/perfis\/novo\?.*suggestionId=/);
  await expect(page.locator("#ptitle")).toHaveValue(left[0]?.payload.title ?? "");
});
