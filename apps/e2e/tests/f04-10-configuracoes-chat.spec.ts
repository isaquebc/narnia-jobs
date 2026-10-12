import { expect, test } from "@playwright/test";
import { api } from "../helpers/api";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

test("F04/E2E-10 configurações do chat e domínios confiáveis: salvar, adicionar com máscara, desligar e restaurar", async ({
  page,
}) => {
  await freshStart("engineer");
  await login(page, "/configuracoes");
  await page.getByLabel("Conversas simultâneas").fill("4");
  await page.getByRole("button", { name: "Salvar preferências do chat" }).click();
  await expect(page.getByText("Preferências salvas.")).toBeVisible();
  expect(
    (await api<{ settings: { maxLiveSessions: number } }>("/api/settings/chat")).settings
      .maxLiveSessions,
  ).toBe(4);

  await page.getByLabel("Novo domínio").fill("*.exemplo-confiavel.org");
  await page.getByRole("button", { name: "Adicionar domínio" }).click();
  await expect(page.getByRole("button", { name: "Remover *.exemplo-confiavel.org" })).toBeVisible();
  await page.getByRole("button", { name: "Remover *.exemplo-confiavel.org" }).click();
  await expect(page.getByRole("button", { name: "Remover *.exemplo-confiavel.org" })).toHaveCount(
    0,
  );

  const ibge = page.getByRole("switch", { name: /Ativo: .*gov\.br/ }).first();
  await ibge.click();
  await expect(ibge).not.toBeChecked();
  await page.getByRole("button", { name: "Restaurar padrões" }).click();
  await expect(page.getByRole("switch", { name: /Ativo: .*gov\.br/ }).first()).toBeChecked();
});
