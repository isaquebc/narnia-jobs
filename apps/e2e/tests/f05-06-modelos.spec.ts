import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { documents, generate, waitDocuments } from "../helpers/documents";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

test("F05/E2E-06 modelos: trocar para Moderno sem gerar; modelo enviado válido é usado; com <script> é recusado com o motivo", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  await generate({ kind: "cv", profileId: ids.profileId });
  await waitDocuments({ profileId: ids.profileId });
  await login(page, "/configuracoes");
  const section = page.getByLabel("Modelos de currículo");
  await page.getByLabel("Enviar modelo (.zip)").setInputFiles({
    name: "com-script.zip",
    mimeType: "application/zip",
    buffer: readFileSync("fixtures/templates/com-script.zip"),
  });
  await expect(section.getByText("<script> não é permitido.")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Enviar modelo (.zip)").setInputFiles({
    name: "minimo.zip",
    mimeType: "application/zip",
    buffer: readFileSync("fixtures/templates/minimo.zip"),
  });
  await expect(section.getByRole("img", { name: "Prévia de Mínimo e2e" })).toBeVisible({
    timeout: 30_000,
  });

  await page.goto(`/perfis/${ids.profileId}/curriculo`);
  await page.getByLabel("Modelo").selectOption({ label: "Moderno" });
  await expect
    .poll(async () => (await documents({ profileId: ids.profileId }))[0], { timeout: 60_000 })
    .toMatchObject({
      document: { templateId: "moderno" },
      current: { version: 2, status: "ready" },
    });
  await page.getByLabel("Modelo").selectOption({ label: "Mínimo e2e" });
  await expect
    .poll(async () => (await documents({ profileId: ids.profileId }))[0]?.current, {
      timeout: 60_000,
    })
    .toMatchObject({ version: 3, status: "ready" });
});
