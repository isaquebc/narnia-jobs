import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, expect, type Page, test } from "@playwright/test";
import { BASE_URL } from "../helpers/api";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

/**
 * F12/E2E-09 (M6): formulário em várias etapas. O clique no ícone na etapa 1 abre o formulário na janela; na mesma aba,
 * a etapa 2 entra no mesmo formulário (sem outra aba na janela), com as perguntas por etapa e o Preencher só na etapa
 * aberta; a etapa 3 entra pelo botão da janela, que lê a mesma aba.
 */
const FIXTURE_HOST = "vagas.example";
const page = (title: string, body: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body><form>${body}<button type="submit">Continuar</button></form></body></html>`;
const STEPS: Record<string, string> = {
  "/aplicar": page(
    "Candidatura · Acme · 1",
    `<label for="nome">Nome completo *</label><input id="nome" required>
     <label for="email">E-mail</label><input id="email" type="email">`,
  ),
  "/aplicar/2": page(
    "Candidatura · Acme · 2",
    `<label for="cidade">Cidade</label><input id="cidade">
     <label for="sobrenome">Sobrenome</label><input id="sobrenome">`,
  ),
  "/aplicar/3": page(
    "Candidatura · Acme · 3",
    `<label for="primeiro">Primeiro nome</label><input id="primeiro">
     <label for="contato">E-mail de contato</label><input id="contato" type="email">`,
  ),
};

let dir: string;
let context: BrowserContext;

test.beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "narnia-ext-"));
  execFileSync("node", ["../extension/build.mjs"], {
    env: {
      ...process.env,
      NARNIA_EXTENSION_OUT: join(dir, "dist"),
      NARNIA_EXTENSION_EXTRA_HOSTS: `${new URL(BASE_URL).hostname},${FIXTURE_HOST}`,
    },
    stdio: "inherit",
  });
});

test.afterEach(async () => {
  await context?.close();
});

test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function pair(p: Page, extensionId: string) {
  await login(p, "/configuracoes");
  const card = p.getByRole("region", { name: "Extensão do navegador" });
  await card.getByRole("button", { name: "Gerar código de pareamento" }).click();
  const code = (await card.locator("code").first().textContent())?.trim() ?? "";
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.getByLabel("Endereço do narnia").fill(BASE_URL);
  await options.getByLabel("Código de pareamento").fill(code);
  await options.getByRole("button", { name: "Parear" }).click();
  await expect(options.getByRole("status")).toHaveText(/Conectado como/);
  await options.close();
}

test("F12/E2E-09 extensão: formulário em várias etapas na mesma aba da janela", async () => {
  test.setTimeout(180_000);
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
  await context.route(`http://${FIXTURE_HOST}/**`, (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: STEPS[new URL(route.request().url()).pathname] ?? "",
    }),
  );
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  await pair(await context.newPage(), extensionId);

  const clickIcon = () =>
    worker.evaluate(async (host) => {
      const g = globalThis as unknown as {
        chrome: { tabs: { query(q: { url: string }): Promise<Array<{ id?: number }>> } };
        narniaIconClick(tab: { id?: number }): Promise<string>;
      };
      const [tab] = await g.chrome.tabs.query({ url: `http://${host}/*` });
      return g.narniaIconClick(tab ?? {});
    }, FIXTURE_HOST);

  const job = await context.newPage();
  await job.goto(`http://${FIXTURE_HOST}/aplicar`);
  const opened = context.waitForEvent("page");
  expect(await clickIcon()).toBe("window");
  const popup = await opened;
  await popup.waitForURL(/\/candidatura\?captura=/);
  await popup.setViewportSize({ width: 480, height: 860 });
  const captureId = new URL(popup.url()).searchParams.get("captura");
  const list = popup.getByRole("list", { name: "Perguntas do formulário" });
  const items = list.locator(":scope > li");
  await expect(items).toHaveCount(2, { timeout: 60_000 });
  await expect(list.getByRole("heading", { name: /^Etapa/ })).toHaveCount(0);

  // etapa 2 na mesma aba: o clique no ícone entra no mesmo formulário, sem outra aba na janela
  await job.goto(`http://${FIXTURE_HOST}/aplicar/2`);
  expect(await clickIcon()).toBe("window");
  await expect(items).toHaveCount(4, { timeout: 60_000 });
  expect(new URL(popup.url()).searchParams.get("captura")).toBe(captureId);
  await expect(list.getByRole("heading", { name: "Etapa 1" })).toBeVisible();
  await expect(list.getByRole("heading", { name: "Etapa 2 · esta página" })).toBeVisible();
  await expect(items.nth(0).getByRole("button", { name: "Preencher" })).toHaveCount(0);
  await expect(items.nth(2)).toContainText("Campinas");
  const menu = popup.getByRole("button", { name: /^Páginas abertas/ });
  await menu.click();
  await expect(
    popup.getByRole("list", { name: "Páginas abertas" }).getByRole("listitem"),
  ).toHaveCount(1);
  await menu.click();

  // Preencher todos: só a etapa aberta na aba
  await popup.getByRole("button", { name: "Preencher todos" }).click();
  await expect(popup.getByText(/2 campos preenchidos na página/)).toBeVisible();
  await expect(job.getByLabel("Cidade")).toHaveValue("Campinas");
  await expect(job.getByLabel("Sobrenome")).toHaveValue("Maria Exemplo");

  // etapa 3 pelo botão da janela: a extensão lê a mesma aba
  await job.goto(`http://${FIXTURE_HOST}/aplicar/3`);
  await popup.getByRole("button", { name: "Ler a próxima etapa nesta aba" }).click();
  await expect(popup.getByText("Etapa 3 lida. Organizando as perguntas…")).toBeVisible();
  await expect(items).toHaveCount(6, { timeout: 60_000 });
  await expect(list.getByRole("heading", { name: "Etapa 2" })).toBeVisible();
  await expect(list.getByRole("heading", { name: "Etapa 3 · esta página" })).toBeVisible();
  // de novo na mesma página: a janela avisa que ela já foi lida
  await popup.getByRole("button", { name: "Ler a próxima etapa nesta aba" }).click();
  await expect(
    popup.getByText("Esta página é a etapa 3, já lida. Avance no formulário e tente de novo."),
  ).toBeVisible();
  expect(
    await popup.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
