import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, expect, test } from "@playwright/test";
import { BASE_URL } from "../helpers/api";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

/**
 * F12/E2E-01 (M1, F12-4, F12-9): a extensão carregada no Chromium do Playwright (nunca o Chrome do dono) pareia pela
 * página de opções com o código de Configurações, testa a conexão e perde o acesso quando o navegador é desconectado.
 * A variante do e2e aceita o host `web` da rede do compose (NARNIA_EXTENSION_EXTRA_HOSTS).
 */
let dir: string;
let context: BrowserContext;

test.beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "narnia-ext-"));
  execFileSync("node", ["../extension/build.mjs"], {
    env: {
      ...process.env,
      NARNIA_EXTENSION_OUT: join(dir, "dist"),
      NARNIA_EXTENSION_EXTRA_HOSTS: new URL(BASE_URL).hostname,
    },
    stdio: "inherit",
  });
});

test.afterEach(async () => {
  await context?.close();
});

test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("F12/E2E-01 extensão: pareia pelo código de Configurações, testa a conexão e perde o acesso ao ser desconectada", async () => {
  await freshStart("engineer");
  const ext = join(dir, "dist");
  context = await chromium.launchPersistentContext(join(dir, "perfil"), {
    channel: "chromium",
    headless: true,
    baseURL: BASE_URL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;

  const page = await context.newPage();
  await login(page, "/configuracoes");
  const card = page.getByRole("region", { name: "Extensão do navegador" });
  await expect(card.getByText("Nenhum navegador conectado ainda.")).toBeVisible();
  await card.getByRole("button", { name: "Gerar código de pareamento" }).click();
  const code = (await card.locator("code").first().textContent())?.trim() ?? "";
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByRole("status")).toHaveText("Ainda não pareado.");
  await options.getByLabel("Endereço do narnia").fill(BASE_URL);
  await options.getByLabel("Código de pareamento").fill(code.toLowerCase());
  await options.getByLabel("Nome deste navegador").fill("Chromium do e2e");
  await options.getByRole("button", { name: "Parear" }).click();
  await expect(options.getByRole("status")).toHaveText(/Pareado como "Chromium do e2e"/);
  await options.getByRole("button", { name: "Testar conexão" }).click();
  await expect(options.getByRole("status")).toHaveText(/Conectado como "Chromium do e2e"/);

  // o mesmo código não serve duas vezes
  await options.getByLabel("Código de pareamento").fill(code);
  await options.getByRole("button", { name: "Parear" }).click();
  await expect(options.getByRole("status")).toHaveText(/Código inválido ou vencido/);

  await page.reload();
  const row = card.getByRole("listitem").filter({ hasText: "Chromium do e2e" });
  await expect(row.getByText(/Último uso:/)).toBeVisible();
  await row.getByRole("button", { name: "Desconectar Chromium do e2e" }).click();
  await expect(card.getByText("Nenhum navegador conectado ainda.")).toBeVisible();

  await options.reload();
  await expect(options.getByRole("status")).toHaveText(/foi desconectado no narnia/);
});
