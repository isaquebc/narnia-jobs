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
