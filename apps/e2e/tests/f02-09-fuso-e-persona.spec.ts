import { expect, test } from "@playwright/test";
import { formatInTz, reset } from "../helpers/api";
import { getCard, login, seed } from "../helpers/profiles";

test("F02/E2E-09 fuso e persona: 'Atualizado em' no fuso do usuário a partir do builtAt; override de tom persiste", async ({
  page,
}) => {
  await reset();
  const { ids } = await seed("engineer");
  await login(page);

  await page.goto(`/perfis/${ids.profileId}/cartao`);
  await expect(page.getByText("Atualizado", { exact: true })).toBeVisible();
  const card = await getCard(ids.profileId);
  await expect(
    page.getByText(`Atualizado em ${formatInTz(card.builtAt, "America/Sao_Paulo")}`),
  ).toBeVisible();
  await expect(page.getByText(/~\d+ tokens · \d+ caracteres/)).toBeVisible();
  await expect(page.getByText(/^Resumo:/).first()).toBeVisible();

  await page.goto(`/perfis/${ids.profileId}/recrutador`);
  await expect(page.locator("#persona-tone")).toHaveValue("direto");
  await expect(page.locator("#persona-honesty")).toHaveValue("maxima");
  await expect(page.locator("#persona-rigor")).toHaveValue("alto");
  await expect(page.locator("#persona-recruiterSeniority")).toHaveValue("senior");
  await expect(page.getByText("ajustado")).toHaveCount(0);

  await page.locator("#persona-tone").selectOption("cordial");
  await page.getByRole("button", { name: "Salvar persona" }).click();
  await expect(page.getByText("Persona salva.")).toBeVisible();
  await page.reload();
  await expect(page.locator("#persona-tone")).toHaveValue("cordial");
  await expect(page.getByText("ajustado")).toHaveCount(1);
  await expect(page.locator("#persona-honesty")).toHaveValue("maxima");

  await page.getByRole("button", { name: "Restaurar padrão Tom" }).click();
  await expect(page.locator("#persona-tone")).toHaveValue("direto");
});
