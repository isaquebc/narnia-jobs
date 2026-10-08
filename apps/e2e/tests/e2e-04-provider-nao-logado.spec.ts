import { expect, test } from "@playwright/test";
import { reset, setMock } from "../helpers/api";
import { expectStep, openApp } from "../helpers/flows";

test("F01/E2E-04 provider não logado: instruções com os dois caminhos, login simulado por volume e por token", async ({
  page,
}) => {
  await reset();
  await setMock({ loggedIn: false });
  await openApp(page);
  await expectStep(page, 1);

  await expect(page.getByText("Não logado").first()).toBeVisible();
  await expect(
    page.getByText("Caminho recomendado: login da assinatura no container"),
  ).toBeVisible();
  await expect(page.getByText("./start.sh login")).toBeVisible();
  await expect(page.getByText("Alternativa: token de longa duração no .env")).toBeVisible();
  await expect(page.getByText("claude setup-token", { exact: true })).toBeVisible();
  const next = page.getByRole("button", { name: "Avançar" });
  await expect(next).toBeDisabled();

  await setMock({ loggedIn: true, authMethod: "claude.ai" });
  await page.getByRole("button", { name: "Verificar de novo" }).click();
  await expect(page.getByText("Logado pela assinatura (login no container)").first()).toBeVisible();
  await expect(page.getByText("Caminho recomendado", { exact: false })).toHaveCount(0);
  await expect(next).toBeEnabled();

  await setMock({ loggedIn: true, authMethod: "oauth_token" });
  await page.getByRole("button", { name: "Verificar de novo" }).click();
  await expect(page.getByText("Logado por token (CLAUDE_CODE_OAUTH_TOKEN)").first()).toBeVisible();
  await next.click();
  await expectStep(page, 2);
});
