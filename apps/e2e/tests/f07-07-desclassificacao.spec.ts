import { expect, test } from "@playwright/test";
import { generate, waitDocuments } from "../helpers/documents";
import { freshStart } from "../helpers/ingest";
import { intake, JD } from "../helpers/postings";
import { login } from "../helpers/profiles";

test("F07/E2E-07 desclassificação › cola o e-mail na etapa › Encerrado com a etapa, a nota e o funil por etapa", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const p = await intake({
    text: `${JD}\n\nEtapas do processo:\n1. Triagem\n2. Case técnico\n3. Conversa com o CTO`,
  });
  await generate({ kind: "cv", profileId: ids.profileId, postingId: p.id });
  await waitDocuments({ postingId: p.id }, 1);

  await login(page, `/vagas/${p.id}`);
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Aplicar nesta vaga" })
    .getByRole("button", { name: "Confirmar candidatura" })
    .click();
  await page.getByRole("link", { name: "Ver candidatura" }).click();

  await page.getByRole("button", { name: "Fui desclassificado(a)" }).click();
  const dialog = page.getByRole("dialog", { name: "Desclassificação" });
  await dialog
    .getByRole("textbox", { name: /E-mail ou motivo/ })
    .fill("Agradecemos sua participação, mas você não seguirá para a próxima etapa.");
  await dialog.getByRole("combobox", { name: "Etapa" }).selectOption({ label: "Case técnico" });
  await dialog.getByRole("button", { name: "Encerrar candidatura" }).click();

  await expect(page.getByText("Não aprovado na etapa Case técnico")).toBeVisible();
  await expect(page.getByRole("button", { name: "Fui desclassificado(a)" })).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "Registros da candidatura" }).getByRole("listitem"),
  ).toContainText("você não seguirá para a próxima etapa");

  await page.goto("/candidaturas");
  await expect(
    page.getByRole("region", { name: "Funil das candidaturas" }).getByText(
      "Não aprovado por etapa: Case técnico: 1",
    ),
  ).toBeVisible();
});
