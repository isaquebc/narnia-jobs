import { expect, test } from "@playwright/test";
import { generate, waitDocuments } from "../helpers/documents";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

test("F05/E2E-08 processos: a geração aparece em /processos; concorrência em Configurações", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  await generate({ kind: "cv", profileId: ids.profileId });
  await waitDocuments({ profileId: ids.profileId });
  await login(page, "/processos");
  await expect(
    page
      .getByRole("region", { name: "Recentes" })
      .getByText("Geração do currículo ou da carta")
      .first(),
  ).toBeVisible();
  await page.goto("/configuracoes");
  const sel = page.getByLabel(/Modelo \(extração/);
  await sel.selectOption("3");
  await expect(page.getByText(/vale em até 15 segundos/)).toBeVisible();
  await expect(sel).toHaveValue("3");
});
