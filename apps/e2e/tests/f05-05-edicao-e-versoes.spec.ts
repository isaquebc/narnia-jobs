import { expect, test } from "@playwright/test";
import { documents, generate, waitDocuments } from "../helpers/documents";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

test("F05/E2E-05 edição na tela e versões: tirar uma seção e mudar o resumo cria a v2 sem o gerador; comparar mostra a mudança", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  await generate({ kind: "cv", profileId: ids.profileId });
  await waitDocuments({ profileId: ids.profileId });
  await login(page, `/perfis/${ids.profileId}/curriculo`);
  await page.getByRole("button", { name: "Editar" }).click();
  const dialog = page.getByRole("dialog", { name: "Editar: Currículo" });
  await dialog.getByRole("textbox", { name: "Resumo" }).fill("Resumo editado na tela.");
  await dialog.getByLabel("Incluir Idiomas").uncheck();
  await dialog.getByRole("button", { name: "Salvar e montar de novo" }).click();
  await expect
    .poll(async () => (await documents({ profileId: ids.profileId }))[0]?.current, {
      timeout: 60_000,
    })
    .toMatchObject({ version: 2, status: "ready" });
  await page.getByText("Versões").click();
  await expect(page.getByText(/v2 · .* · editada/)).toBeVisible();
  await page.getByRole("button", { name: "Comparar com a anterior" }).click();
  const diff = page.getByRole("dialog", { name: "v1 → v2" });
  await expect(diff.getByText(/\+ Resumo editado na tela\./)).toBeVisible();
  await expect(diff.getByText(/- .*Inglês \(C1\)/)).toBeVisible();
});
