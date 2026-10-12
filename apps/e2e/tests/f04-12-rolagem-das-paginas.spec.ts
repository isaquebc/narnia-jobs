import { expect, test } from "@playwright/test";
import { createProfile } from "../helpers/chat";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

/**
 * Auditoria pós-F04 · bloco D (2026-10-12): com o Shell em `h-screen` quem rola é o <main>, não a janela. Trocar de
 * página pelo menu precisa voltar o <main> ao topo, e os painéis do cabeçalho não podem passar da altura da janela.
 */
const mainScroll = (page: import("@playwright/test").Page) =>
  page.locator("main").evaluate((el) => ({
    top: el.scrollTop,
    max: el.scrollHeight - el.clientHeight,
  }));

test("F04/E2E-12 navegação pelo menu volta o conteúdo ao topo", async ({ page }) => {
  await freshStart("long");
  await page.setViewportSize({ width: 1280, height: 360 });
  const nav = page.getByRole("navigation");
  // as duas páginas já visitadas (em cache): o destino renderiza inteiro de cara, sem o "carregando" que zeraria a
  // rolagem por acaso; é o caso em que o <main> guardava a posição da página anterior
  await login(page);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await nav.getByRole("link", { name: "Configurações" }).click();
  await expect(page).toHaveURL(/\/configuracoes$/);
  await nav.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect.poll(async () => (await mainScroll(page)).max).toBeGreaterThan(100);
  await page.locator("main").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect((await mainScroll(page)).top).toBeGreaterThan(100);

  await nav.getByRole("link", { name: "Configurações" }).click();
  await expect(page).toHaveURL(/\/configuracoes$/);
  await expect.poll(async () => (await mainScroll(page)).max).toBeGreaterThan(50);
  await expect.poll(async () => (await mainScroll(page)).top).toBe(0);
});

test("F04/E2E-12 painéis do cabeçalho cabem na janela baixa e rolam por dentro", async ({
  page,
}) => {
  await freshStart("engineer");
  for (let i = 0; i < 8; i++) await createProfile(`Perfil extra ${i}`);
  await page.setViewportSize({ width: 1280, height: 360 });
  await login(page);
  await page.getByRole("button", { name: "Trocar perfil" }).click();
  const menu = page.getByRole("menu", { name: "Trocar perfil" });
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  if (!box) throw new Error("menu sem caixa");
  expect(box.y + box.height).toBeLessThanOrEqual(360);
  // o último item ("Gerenciar perfis") é alcançável rolando dentro do painel
  const manage = menu.getByRole("link", { name: "Gerenciar perfis" });
  await manage.scrollIntoViewIfNeeded();
  await expect(manage).toBeInViewport();
  await manage.click();
  await expect(page).toHaveURL(/\/perfis$/);
});
