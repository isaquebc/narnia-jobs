import { expect, test } from "@playwright/test";
import { api } from "../helpers/api";
import { generate, waitDocuments } from "../helpers/documents";
import { freshStart } from "../helpers/ingest";
import { intake, JD } from "../helpers/postings";
import { login } from "../helpers/profiles";

interface AppRow {
  id: string;
  appliedOn: string;
  column: string;
  cv: { version: number };
}

test("F07/E2E-01 vaga › Aplicar (CV travado, data trocada) › quadro: mover, x/N em Em processo, encerrar com motivo, busca", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const p = await intake({ text: JD });
  await generate({ kind: "cv", profileId: ids.profileId, postingId: p.id });
  await waitDocuments({ postingId: p.id }, 1);

  await login(page, `/vagas/${p.id}`);
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Aplicar nesta vaga" });
  await expect(dialog.getByRole("radio", { name: "CV desta vaga · versão 1" })).toBeChecked();
  await dialog.getByRole("button", { name: "Mudar a data" }).click();
  await dialog.getByLabel("Data da candidatura").fill("2026-10-20");
  await dialog.getByRole("button", { name: "Confirmar candidatura" }).click();
  const view = page.getByRole("link", { name: "Ver candidatura" });
  await expect(view).toBeVisible();

  const [created] = (await api<{ applications: AppRow[] }>("/api/job-applications")).applications;
  expect(created).toMatchObject({ appliedOn: "2026-10-20", column: "applied", cv: { version: 1 } });

  // regerar o CV depois não muda o que foi enviado
  await generate({ kind: "cv", profileId: ids.profileId, postingId: p.id });
  await waitDocuments({ postingId: p.id }, 1);
  const again = await api<{ application: AppRow }>(`/api/job-applications/${created?.id}`);
  expect(again.application.cv.version).toBe(1);

  await view.click();
  await expect(
    page.getByRole("list", { name: "Etapas do processo" }).getByRole("listitem"),
  ).toHaveCount(6);

  await page.goto("/candidaturas");
  const board = page.getByRole("region", { name: "Quadro das candidaturas" });
  const card = board.getByRole("list", { name: "Aplicado" }).getByRole("listitem");
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "Mover" }).click();
  await page.getByRole("menuitem", { name: "Em processo" }).click();
  const inProcess = board.getByRole("list", { name: "Em processo" }).getByRole("listitem");
  await expect(inProcess.getByText("1/6")).toBeVisible();

  await inProcess.getByRole("button", { name: "Mover" }).click();
  await page.getByRole("menuitem", { name: "Encerrado" }).click();
  const close = page.getByRole("dialog", { name: "Encerrar candidatura" });
  await close.getByLabel(/Motivo/).selectOption("no_response");
  await close.getByRole("button", { name: "Encerrar" }).click();
  await expect(
    board.getByRole("list", { name: "Encerrado" }).getByText("Sem retorno"),
  ).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Buscar candidaturas" });
  await search.fill("20/10/2026");
  await expect(board.getByRole("listitem")).toHaveCount(1);
  await search.fill("empresa que não existe");
  await expect(page.getByText("Nenhuma candidatura com essa busca.")).toBeVisible();
});
