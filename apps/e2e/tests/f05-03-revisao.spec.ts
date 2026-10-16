import { expect, test } from "@playwright/test";
import { api } from "../helpers/api";
import { documents, generate, waitDocuments } from "../helpers/documents";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

test("F05/E2E-03 revisão: reprova duas vezes → alerta com os apontamentos; Atualizar → aprova e o alerta some", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  await api("/api/_test/mock", { method: "POST", body: JSON.stringify({ cvReviewFailures: 2 }) });
  await generate({ kind: "cv", profileId: ids.profileId });
  const [doc] = await waitDocuments({ profileId: ids.profileId });
  expect(doc?.current?.status).toBe("ready_with_issues");
  await login(page, `/perfis/${ids.profileId}/curriculo`);
  const alert = page.getByRole("alert", { name: "Não passou na revisão" });
  await expect(alert).toContainText("Layout: Simulação: texto sobreposto");
  await page.getByRole("button", { name: "Atualizar" }).click();
  const dialog = page.getByRole("dialog", { name: "Atualizar: Currículo" });
  await dialog.getByRole("button", { name: "Atualizar" }).click();
  await expect
    .poll(async () => (await documents({ profileId: ids.profileId }))[0]?.current?.status, {
      timeout: 60_000,
    })
    .toBe("ready");
  await expect(alert).toHaveCount(0);
});

test("F05/E2E-03b revisão: 'Tentar de novo' no alerta refaz e aprova; a página da prévia abre em tela cheia", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  await api("/api/_test/mock", { method: "POST", body: JSON.stringify({ cvReviewFailures: 2 }) });
  await generate({ kind: "cv", profileId: ids.profileId });
  await waitDocuments({ profileId: ids.profileId });
  await login(page, `/perfis/${ids.profileId}/curriculo`);
  const alert = page.getByRole("alert", { name: "Não passou na revisão" });
  await alert.getByRole("button", { name: "Tentar de novo" }).click();
  await expect
    .poll(async () => (await documents({ profileId: ids.profileId }))[0]?.current, {
      timeout: 60_000,
    })
    .toMatchObject({ version: 2, status: "ready" });
  await expect(alert).toHaveCount(0);
  await page.getByRole("button", { name: "Ampliar a página 1" }).click();
  const viewer = page.getByRole("dialog", { name: /^Página 1 de \d+$/ });
  await expect(viewer.getByRole("img", { name: "Página 1" })).toBeVisible();
  const box = await viewer.boundingBox();
  const vp = page.viewportSize();
  expect(box?.width).toBe(vp?.width);
  expect(box?.height).toBe(vp?.height);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});
