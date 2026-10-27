import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, expect, type Page, test } from "@playwright/test";
import { BASE_URL } from "../helpers/api";
import { freshStart } from "../helpers/ingest";
import { login } from "../helpers/profiles";

/**
 * F12/E2E-02 (M2, F12-2): numa página de vaga, o clique no ícone lê a aba, abre a janela do narnia com a vaga lida e
 * "Salvar vaga" entra pelo fluxo da F06; clicar de novo na mesma vaga reaproveita a janela e avisa que ela já está
 * salva; salvar assim mesmo mostra a comparação de vaga repetida na janela. A página de vaga é uma fixture servida pelo próprio Playwright em `http://vagas.example` (host extra do build
 * do e2e). O Playwright não clica na barra do Chrome: o teste chama o mesmo fluxo pelo service worker.
 */
const FIXTURE_HOST = "vagas.example";
const DESCRIPTION = `<p>Buscamos uma pessoa engenheira backend para o time de pagamentos.</p>
<h3>Requisitos</h3><ul><li>5+ anos com Java e Spring</li><li>Kafka e PostgreSQL</li>
<li>Docker e Kubernetes em produção</li></ul><h3>Diferenciais</h3><ul><li>AWS</li></ul>
<p>Trabalho híbrido em São Paulo, CLT, com plano de saúde e vale refeição.</p>`;
const JOB_PAGE = `<!doctype html><html><head><title>Vagas</title>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Engenheira Backend Sênior",
  description: DESCRIPTION,
  hiringOrganization: { "@type": "Organization", name: "Acme Pagamentos" },
})}</script></head><body><nav>Início · Entrar</nav>
<main><h1>Engenheira Backend Sênior</h1>${DESCRIPTION}</main></body></html>`;
/** O formulário da mesma vaga, em outra página do mesmo site (o "Candidatar-se" da página). */
const FORM_PAGE = `<!doctype html><html><head><title>Candidatura · Acme</title></head><body>
<form><label for="nome">Nome completo *</label><input id="nome" name="nome" required>
<label for="email">E-mail</label><input id="email" type="email" name="email">
<button type="submit">Enviar</button></form></body></html>`;

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

async function pair(page: Page, extensionId: string) {
  await login(page, "/configuracoes");
  const card = page.getByRole("region", { name: "Extensão do navegador" });
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

test("F12/E2E-02 extensão: página de vaga → janela → Salvar vaga → análise → CV e carta → aviso de já salva", async () => {
  test.setTimeout(240_000);
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
      body: route.request().url().includes("/aplicar") ? FORM_PAGE : JOB_PAGE,
    }),
  );
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await pair(page, extensionId);

  const job = await context.newPage();
  await job.goto(`http://${FIXTURE_HOST}/vagas/123?utm_source=e2e`);
  const click = () =>
    worker.evaluate(async (host) => {
      const g = globalThis as unknown as {
        chrome: { tabs: { query(q: { url: string }): Promise<Array<{ id?: number }>> } };
        narniaIconClick(tab: { id?: number }): Promise<string>;
      };
      const [tab] = await g.chrome.tabs.query({ url: `http://${host}/*` });
      return g.narniaIconClick(tab ?? {});
    }, FIXTURE_HOST);

  const opened = context.waitForEvent("page");
  expect(await click()).toBe("window");
  const popup = await opened;
  await popup.waitForURL(/\/candidatura\?captura=/);
  await expect(popup.getByRole("heading", { name: "Engenheira Backend Sênior" })).toBeVisible();
  await expect(popup.getByText("Acme Pagamentos")).toBeVisible();
  await expect(popup.getByText(/time de pagamentos/)).toBeVisible();
  await expect(popup.getByText("Início · Entrar")).toHaveCount(0);
  await expect(popup.getByRole("navigation")).toHaveCount(0);
  // cabe na janela, sem rolagem lateral, e a descrição vai até o fim (testes do dono, 2026-10-23); no headless o
  // tamanho da janela popup não vira o viewport, então o teste usa o mesmo da extensão (480 × 860)
  await popup.setViewportSize({ width: 480, height: 860 });
  expect(
    await popup.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await popup.getByText(/vale refeição/).scrollIntoViewIfNeeded();
  await expect(popup.getByText(/vale refeição/)).toBeInViewport();
  await popup.getByRole("button", { name: "Salvar vaga" }).click();
  await expect(popup.getByRole("status")).toContainText("Vaga salva");
  await expect(popup.getByRole("link", { name: "Abrir a vaga no narnia" })).toHaveAttribute(
    "href",
    /\/vagas\/.+/,
  );

  // salvar também analisa, e o resultado aparece na mesma janela (pedido do dono, 2026-10-23)
  const result = popup.getByRole("region", { name: "Análise da vaga" });
  await expect(result).toBeVisible({ timeout: 90_000 });
  await expect(result.getByText(/fit \d+/).first()).toBeVisible();

  // depois da análise, CV e carta na mesma janela, com o download
  await popup.getByRole("button", { name: "Gerar CV e carta" }).click();
  const docs = popup.getByRole("region", { name: "Currículo e carta" });
  await expect(docs.getByRole("link", { name: "Baixar o CV" })).toBeVisible({ timeout: 120_000 });
  await expect(docs.getByRole("link", { name: "Baixar a carta" })).toBeVisible({
    timeout: 120_000,
  });

  // a vaga entrou pela F06
  await page.goto("/vagas");
  await expect(page.getByText("Engenheira Backend Sênior").first()).toBeVisible();

  // de novo na mesma vaga: a mesma janela, com o aviso de vaga já salva (mesmo link, sem o rastreio)
  const pagesBefore = context.pages().length;
  const firstUrl = popup.url();
  expect(await click()).toBe("window");
  await expect.poll(() => popup.url()).not.toBe(firstUrl);
  await popup.waitForURL(/\/candidatura\?captura=/);
  await expect(
    popup.getByText(/Parece a vaga "Engenheira Backend Sênior · Acme Pagamentos"/),
  ).toBeVisible();
  expect(context.pages().length).toBe(pagesBefore);

  // salvar assim mesmo: a extração acha a salva pelo link e a janela pede a decisão antes de analisar; descartar
  // volta para a salva, com a análise que ela já tem
  await popup.getByRole("button", { name: "Salvar vaga" }).click();
  const dialog = popup.getByRole("dialog", { name: "Vaga repetida?" });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await expect(popup.getByText(/A análise começa depois que você decidir/)).toBeVisible();
  await dialog.getByRole("button", { name: "Descartar esta vaga" }).click();
  await expect(popup.getByRole("region", { name: "Análise da vaga" })).toBeVisible();
  await page.goto("/vagas");
  await expect(page.getByText("Engenheira Backend Sênior")).toHaveCount(1);

  // candidatar-se sem duplicar (pedido do dono, 2026-10-27): na mesma aba do Chrome, a pessoa vai ao formulário e a
  // janela procura por ele; o formulário entra nesta aba da janela, ligado à vaga
  await job.goto(`http://${FIXTURE_HOST}/vagas/123/aplicar`);
  await popup.getByRole("button", { name: "Procurar o formulário nesta aba" }).click();
  await expect(popup.getByRole("heading", { name: "Formulário de candidatura" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(popup.getByRole("list", { name: "Perguntas do formulário" })).toBeVisible({
    timeout: 60_000,
  });
  // as mesmas duas páginas no menu (a primeira captura e esta), nenhuma nova
  await popup.getByRole("button", { name: /^Páginas abertas/ }).click();
  await expect(
    popup.getByRole("list", { name: "Páginas abertas" }).getByRole("listitem"),
  ).toHaveCount(2);
  expect(context.pages().length).toBe(pagesBefore);
});
