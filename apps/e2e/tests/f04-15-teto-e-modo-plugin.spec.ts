import { expect, test } from "@playwright/test";
import { createSession } from "../helpers/chat";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

test("F04/E2E-15 Configurações: teto de custo por conversa aparece no rodapé do chat; Modo plugin mostra o MCP desta instância", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  await login(page, "/configuracoes");

  const plugin = page.getByRole("region", { name: "Modo plugin (terminal)" });
  await expect(plugin.getByText(/MCP respondendo: \d+ ferramentas/)).toBeVisible();
  await expect(plugin.getByText("./start.sh install-plugin")).toBeVisible();
  await expect(plugin.getByText(/\/mcp$/)).toBeVisible();

  await page.getByLabel("Teto de custo por conversa (US$)").fill("2.5");
  await page.getByRole("button", { name: "Salvar preferências do chat" }).click();
  await expect(page.getByText("Preferências salvas.")).toBeVisible();

  const s = await createSession({ profileId: ids.profileId, title: "Teto" });
  await page.goto(`/chat/${s.id}`);
  await expect(page.getByTestId("session-usage")).toContainText(/teto US\$\s?2,50/);
});
