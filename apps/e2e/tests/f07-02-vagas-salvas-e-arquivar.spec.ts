import { expect, test } from "@playwright/test";
import { generate, waitDocuments } from "../helpers/documents";
import { freshStart } from "../helpers/ingest";
import { intake, JD } from "../helpers/postings";
import { login } from "../helpers/profiles";

test("F07/E2E-02 Vagas salvas no quadro › Aplicar dali › vaga aplicada em destaque; outra vaga arquivada com o motivo", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const p = await intake({ text: JD });
  const other = await intake({ fields: { company: "Outra Empresa", title: "Analista de Dados" } });
  await generate({ kind: "cv", profileId: ids.profileId, postingId: p.id });
  await waitDocuments({ postingId: p.id }, 1);

  await login(page, "/candidaturas");
  const board = page.getByRole("region", { name: "Quadro das candidaturas" });
  const saved = board.getByRole("list", { name: "Vagas salvas" });
  await expect(saved.getByRole("listitem")).toHaveCount(2);
  const card = saved.getByRole("listitem").filter({ hasNotText: "Outra Empresa" });
  await card.getByRole("button", { name: "Aplicar", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Aplicar nesta vaga" })
    .getByRole("button", { name: "Confirmar candidatura" })
    .click();
  await expect(board.getByRole("list", { name: "Aplicado" }).getByRole("listitem")).toHaveCount(1);
  await expect(saved.getByRole("listitem")).toHaveCount(1);

  await page.goto("/vagas");
  const list = page.getByRole("list", { name: "Vagas" });
  await expect(list.getByText("Aplicada · Aplicado")).toHaveCount(1);

  await page.goto(`/vagas/${other.id}`);
  await page.getByRole("button", { name: "Arquivar vaga" }).click();
  const dialog = page.getByRole("dialog", { name: "Arquivar vaga" });
  await dialog.getByLabel(/Por que não deu fit/).selectOption("seniority");
  await dialog.getByLabel(/Detalhe/).fill("Pede staff; busco sênior.");
  await dialog.getByRole("button", { name: "Arquivar", exact: true }).click();
  await expect(page.getByText(/Arquivada em .* · Senioridade/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Aplicar", exact: true })).toHaveCount(0);

  await page.goto("/vagas");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("checkbox", { name: "Ver arquivadas" }).check();
  await expect(list.getByText("Arquivada · Senioridade")).toBeVisible();

  await page.goto("/candidaturas");
  await expect(saved.getByRole("listitem")).toHaveCount(0);
});
