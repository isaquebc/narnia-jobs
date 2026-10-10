import { expect, test } from "@playwright/test";
import { api } from "../helpers/api";
import { freshStart, openIngestion, setGithub } from "../helpers/ingest";

test("F03/E2E-10 conexão do GitHub: sem gh no computador cai no login do app por código, conecta por WS e desconecta", async ({
  page,
}) => {
  await freshStart("engineer");
  await setGithub({ hostTokenAvailable: false, authenticated: false });
  await openIngestion(page);

  // origem "host" sem gh no computador: a tela oferece cair no login próprio do app
  await page.getByRole("button", { name: "Usar login próprio do app" }).click();
  await expect(page.getByRole("radio", { name: "Login próprio do app" })).toBeChecked();
  await page.getByRole("button", { name: "Conectar GitHub" }).click();
  await expect(page.getByText(/[A-Z0-9]{4}-[A-Z0-9]{4}/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Copiar" })).toBeVisible();
  const open = page.getByRole("link", { name: "Abrir GitHub" });
  await expect(open).toHaveAttribute("target", "_blank");
  await expect(open).toHaveAttribute("href", /github\.com\/login\/device/);
  await expect(page.getByText(/Expira em \d{1,2}:\d{2}/)).toBeVisible();

  // o usuário autoriza no GitHub; a api percebe e avisa a tela por WS
  await setGithub({ deviceComplete: true, authenticated: true });
  await expect(page.getByText("Conectado como @ana-exemplo")).toBeVisible();
  const status = await api<{ connected: boolean; source: string }>("/api/github/auth");
  expect(status).toMatchObject({ connected: true, source: "app" });

  await page.getByRole("button", { name: "Desconectar" }).click();
  await expect(page.getByRole("button", { name: "Conectar GitHub" })).toBeVisible();
});
