import { expect, test } from "@playwright/test";
import { waitDocuments } from "../helpers/documents";
import { freshStart } from "../helpers/ingest";
import { intake, JD } from "../helpers/postings";
import { login } from "../helpers/profiles";

test("F05/E2E-02 vaga › Gerar › CV com a carta junto (texto): os dois na página da vaga, ligados ao perfil", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const p = await intake({ text: JD });
  await login(page, `/vagas/${p.id}`);
  await page.getByRole("button", { name: "Gerar", exact: true }).click();
  await page.getByRole("menuitem", { name: "CV" }).click();
  const dialog = page.getByRole("dialog", { name: "Gerar currículo" });
  await dialog.getByLabel("Gerar a carta de apresentação junto").check();
  await dialog.getByLabel("Formato da carta").selectOption("text");
  await dialog.getByRole("button", { name: "Gerar", exact: true }).click();
  const docs = await waitDocuments({ postingId: p.id }, 2);
  expect(docs.map((d) => d.document.kind).sort()).toEqual(["cover_letter", "cv"]);
  const section = page.getByRole("region", { name: "Currículos e cartas" });
  await expect(section.getByText("Carta de apresentação · Eng. Software Sênior")).toBeVisible();
  await expect(section.getByRole("button", { name: "Copiar" })).toBeVisible();
  await expect(section.getByText(/Me candidato à vaga|Olá, time da/).first()).toBeVisible();
  // a aba do perfil lista os documentos da vaga com o link
  await page.goto(`/perfis/${ids.profileId}/curriculo`);
  await expect(
    page
      .getByRole("region", { name: "Currículos e cartas de vagas com este perfil" })
      .getByRole("link", { name: "Abrir a vaga" })
      .first(),
  ).toBeVisible();
});
