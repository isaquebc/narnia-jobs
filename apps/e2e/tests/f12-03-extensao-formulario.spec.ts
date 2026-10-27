import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, expect, type Page, test } from "@playwright/test";
import { BASE_URL } from "../helpers/api";
import { freshStart } from "../helpers/ingest";
import { intake } from "../helpers/postings";
import { login } from "../helpers/profiles";

/**
 * F12/E2E-03 (M3): numa página de candidatura, o clique no ícone lê o formulário (rótulos por label, texto vizinho,
 * fieldset, rádios e select), abre a janela no modo formulário e mostra as perguntas organizadas (heurística + mock do
 * Haiku), com o valor dos campos óbvios para copiar; consentimento e autodeclaração ficam com a pessoa. Nada é
 * preenchido na página.
 */
const FIXTURE_HOST = "vagas.example";
const FORM_PAGE = `<!doctype html><html><head><title>Candidatura · Acme</title></head><body>
<h1>Engenheira Backend Sênior · Acme Pagamentos</h1>
<form>
  <h2>Dados pessoais</h2>
  <label for="nome">Nome completo *</label><input id="nome" name="nome" required>
  <label for="email">E-mail</label><input id="email" type="email" name="email">
  <h2>Perguntas</h2>
  <div><span>Por que você quer trabalhar na Acme?</span><textarea name="motivo" maxlength="800"></textarea></div>
  <fieldset><legend>Disponível para viagens?</legend>
    <label><input type="radio" name="viagem" value="s"> Sim</label>
    <label><input type="radio" name="viagem" value="n"> Não</label></fieldset>
  <label for="raca">Raça/cor</label><select id="raca" name="raca"><option value="">Selecione</option>
    <option value="1">Branca</option><option value="9">Prefiro não informar</option></select>
  <label><input type="checkbox" name="lgpd"> Li e aceito a política de privacidade</label>
  <label for="cv">Currículo (PDF)</label><input id="cv" type="file" accept=".pdf">
  <input type="hidden" name="csrf" value="segredo">
  <button type="submit">Enviar</button>
</form></body></html>`;

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

test("F12/E2E-03 extensão: formulário de candidatura → perguntas → copiar, preencher, motivações, respostas e CV anexado", async () => {
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
  // http://web não é contexto seguro (no 127.0.0.1 do dono é): a área de transferência vira um registro na página
  await context.addInitScript(() => {
    if (!navigator.clipboard)
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (t: string) => {
            (window as unknown as { __copied?: string }).__copied = t;
          },
        },
      });
  });
  await context.route(`http://${FIXTURE_HOST}/**`, (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: FORM_PAGE }),
  );
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await pair(page, extensionId);

  const job = await context.newPage();
  await job.goto(`http://${FIXTURE_HOST}/vagas/123/aplicar`);
  await job.getByLabel("Nome completo *").fill("digitado na página");
  const opened = context.waitForEvent("page");
  expect(
    await worker.evaluate(async (host) => {
      const g = globalThis as unknown as {
        chrome: { tabs: { query(q: { url: string }): Promise<Array<{ id?: number }>> } };
        narniaIconClick(tab: { id?: number }): Promise<string>;
      };
      const [tab] = await g.chrome.tabs.query({ url: `http://${host}/*` });
      return g.narniaIconClick(tab ?? {});
    }, FIXTURE_HOST),
  ).toBe("window");
  const popup = await opened;
  await popup.waitForURL(/\/candidatura\?captura=/);
  await popup.setViewportSize({ width: 480, height: 860 });
  await expect(popup.getByRole("heading", { name: "Formulário de candidatura" })).toBeVisible();
  const list = popup.getByRole("list", { name: "Perguntas do formulário" });
  await expect(list).toBeVisible({ timeout: 60_000 });
  // só as perguntas: as suposições do roleplay são uma lista dentro do item
  const items = list.locator(":scope > li");
  await expect(items).toHaveCount(7);
  await expect(items.nth(0)).toContainText("Nome completo");
  await expect(items.nth(0)).toContainText("Ana Maria Exemplo");
  await expect(items.nth(1)).toContainText("ana.exemplo@example.com");
  await expect(items.nth(2)).toContainText("até 800 caracteres");
  await expect(items.nth(3)).toContainText("Sim · Não");
  await expect(items.nth(4)).toContainText("autodeclaração");
  await expect(items.nth(5)).toContainText("Você decide");
  await items.nth(0).getByRole("button", { name: "Copiar" }).click();
  await expect(items.nth(0).getByRole("button", { name: "Copiado" })).toBeVisible();
  expect(await popup.evaluate(() => (window as unknown as { __copied?: string }).__copied)).toBe(
    "Ana Maria Exemplo",
  );
  // o que a pessoa digitou na página e os campos ocultos não saem do navegador
  await expect(popup.getByText("digitado na página")).toHaveCount(0);

  // preencher (F12-14): a janela pede à extensão, que escreve na aba de origem; consentimento fica com a pessoa
  await popup.getByRole("button", { name: "Preencher todos" }).click();
  await expect(popup.getByText(/2 campos preenchidos na página/)).toBeVisible();
  await expect(job.getByLabel("Nome completo *")).toHaveValue("Ana Maria Exemplo");
  await expect(job.getByLabel("E-mail")).toHaveValue("ana.exemplo@example.com");
  await expect(job.getByLabel("Li e aceito a política de privacidade")).not.toBeChecked();

  // abas (F12-16): a página da vaga aberta pela extensão vira outra aba na mesma janela
  const vaga = await context.newPage();
  await vaga.goto(`http://${FIXTURE_HOST}/vagas/123`);
  await vaga.bringToFront();
  await worker.evaluate(async (host) => {
    const g = globalThis as unknown as {
      chrome: {
        tabs: { query(q: { url: string }): Promise<Array<{ id?: number; url?: string }>> };
      };
      narniaIconClick(tab: { id?: number }, mode?: string): Promise<string>;
    };
    const tabs = await g.chrome.tabs.query({ url: `http://${host}/*` });
    const tab = tabs.find((t) => t.url?.endsWith("/vagas/123"));
    return g.narniaIconClick(tab ?? {}, "posting");
  }, FIXTURE_HOST);
  // em menu (pedido do dono, 2026-10-27)
  await expect(popup.getByRole("button", { name: /^Páginas abertas/ })).toContainText("2", {
    timeout: 30_000,
  });
  await popup.getByRole("button", { name: /^Páginas abertas/ }).click();
  const tabs = popup.getByRole("list", { name: "Páginas abertas" }).getByRole("listitem");
  await expect(tabs).toHaveCount(2);
  await tabs.first().getByRole("button").first().click();
  await expect(popup.getByRole("list", { name: "Perguntas do formulário" })).toBeVisible();

  // F12/M4: ligada a uma vaga salva, as respostas sugeridas chegam (mock do Sonnet) e entram no Preencher todos
  await intake({ fields: { title: "Engenheira Backend Sênior", company: "Acme Pagamentos" } });
  await popup.getByRole("button", { name: "Ligar a uma vaga salva" }).click();
  await popup
    .getByRole("combobox", { name: "Vaga salva" })
    .selectOption({ label: "Engenheira Backend Sênior · Acme Pagamentos" });
  // F12-23: o perfil ainda não tem motivações; antes das respostas, a janela sugere frases pelo histórico (mock)
  const step = popup.getByRole("region", { name: "Antes das respostas: o que te move" });
  const phrases = step.getByRole("list", { name: "Motivações" }).getByRole("listitem");
  await expect(phrases.first()).toBeVisible({ timeout: 60_000 });
  // conta só depois que a sugestão termina (as frases podem chegar em mais de uma leva)
  await expect(step.getByText("Sugerindo frases pelo seu histórico…")).toBeHidden({
    timeout: 60_000,
  });
  const before = await phrases.count();
  await phrases.first().getByRole("button", { name: "Aceitar" }).click();
  await expect(phrases.first()).toContainText("Aceita");
  // recusada: fica guardada e outra vem no lugar
  await phrases.nth(1).getByRole("button", { name: "Recusar" }).click();
  await expect(step.getByText("1 recusada(s)")).toBeVisible();
  await expect(phrases).toHaveCount(before, { timeout: 60_000 });
  await step
    .getByRole("combobox", { name: "Como o narnia se refere a você" })
    .selectOption("feminino");
  await step.getByRole("button", { name: "Escrever as respostas" }).click();
  await expect(step).toBeHidden({ timeout: 30_000 });
  // F12-18/19: a pergunta aberta vem do roleplay (com as suposições) e a pessoa edita antes de preencher
  const motivo = popup.getByLabel("Resposta: Por que você quer trabalhar na Acme?");
  await expect(motivo).toHaveValue(/Quero trabalhar na Acme Pagamentos/, { timeout: 60_000 });
  await expect(items.nth(2)).toContainText("Escrita como você");
  await expect(items.nth(2)).toContainText("Confira antes de preencher (o narnia supôs):");
  // F12-23: a suposição aceita vai para as motivações do perfil
  const assumptions = items.nth(2).getByRole("list", { name: "O que o narnia supôs" });
  await assumptions.getByRole("button", { name: "Aceitar" }).first().click();
  await expect(assumptions.getByText("Aceita")).toBeVisible();
  await expect(items.nth(3)).toContainText("Sim");
  await motivo.fill("Quero trabalhar na Acme porque pagamentos é o que eu faço melhor.");
  await motivo.blur();
  await expect(items.nth(2)).toContainText("Editada por você");
  await popup.getByRole("button", { name: "Preencher todos" }).click();
  await expect(job.locator('textarea[name="motivo"]')).toHaveValue(
    "Quero trabalhar na Acme porque pagamentos é o que eu faço melhor.",
  );
  await expect(job.getByLabel("Sim")).toBeChecked();

  // o campo do currículo anexa o PDF do CV da vaga
  const docs = popup.getByRole("region", { name: "Currículo e carta" });
  await docs.getByRole("button", { name: "Gerar CV", exact: true }).click();
  await expect(docs.getByRole("link", { name: "Baixar o CV" })).toBeVisible({ timeout: 120_000 });
  await items.nth(6).getByRole("button", { name: "Anexar o CV" }).click();
  await expect(popup.getByText("Preenchido na página.")).toBeVisible();
  expect(
    await job.evaluate(() => {
      const f = (document.getElementById("cv") as HTMLInputElement).files?.[0];
      return f ? [f.name, f.type, f.size > 100] : null;
    }),
  ).toEqual(["curriculo.pdf", "application/pdf", true]);
  expect(
    await popup.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  // F12/M5: a conversa do formulário (o recrutador do mock lê as perguntas e grava a resposta nova na lista)
  await popup.getByRole("button", { name: "Conversa" }).click();
  await popup
    .getByRole("textbox", { name: "Mensagem para o recrutador" })
    .fill("Reescreve a motivação, por favor.");
  await popup.getByRole("button", { name: "Enviar" }).click();
  await expect(
    popup.getByText("Gravei a resposta nova; ela está na janela, em Perguntas."),
  ).toBeVisible({ timeout: 60_000 });
  await popup.getByRole("button", { name: "Perguntas" }).click();
  await expect(items.nth(2)).toContainText("Escrita no chat");
  await expect(motivo).toHaveValue(/Resposta combinada no chat/);

  // a bandeja do app, em overlay sobre a janela
  await popup.getByRole("button", { name: "Atividades" }).click();
  const tray = popup.getByRole("dialog", { name: "Atividades" });
  await expect(tray).toBeVisible();
  await tray.getByRole("button", { name: "Fechar a bandeja" }).click();
  await expect(tray).toBeHidden();
});
