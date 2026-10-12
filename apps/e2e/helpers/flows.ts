/** Fluxos reutilizados pelos cenários: cada função cobre um trecho do wizard pela interface, como o usuário faria. */
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { TOKEN } from "./api";

export const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

/** Abre a interface pela URL com token (como o lançador imprime) e espera o roteador decidir o passo. */
export async function openApp(page: Page, path = "/") {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}token=${TOKEN}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

export async function expectStep(page: Page, step: number) {
  await expect(page).toHaveURL(new RegExp(`/onboarding/${step}$`));
  await expect(page.getByText(`Passo ${step} de 6`)).toBeVisible();
}

/** Passo 1 → 2 com o mock logado. */
export async function passProvider(page: Page) {
  await expectStep(page, 1);
  await page.getByRole("button", { name: "Avançar" }).click();
  await expectStep(page, 2);
}

/** Passo 2: seleciona um arquivo e espera o upload e a estimativa. */
export async function chooseFile(page: Page, name: string) {
  await page.locator('input[type="file"]').setInputFiles(fixture(name));
  // abaixo do limiar de autoconfirmação (F03-13) o passo pode seguir sozinho antes de a estimativa ficar na tela
  if (/\/onboarding\/3$/.test(page.url())) return;
  await expect(
    page.getByText(`Arquivo selecionado: ${name}`).or(page.getByText("Passo 3 de 6")),
  ).toBeVisible();
  await expect(
    page
      .getByText(/~.* tokens no total/)
      .or(page.getByText("Abaixo do limite de confirmação: a extração começa sozinha."))
      .or(page.getByText("Passo 3 de 6"))
      .first(),
  ).toBeVisible();
}

/**
 * Passo 2 → 3. Abaixo do limiar de autoconfirmação (F03-13, também no onboarding desde as correções da auditoria F03)
 * a extração começa sozinha; acima dele, o clique em "Extrair" é necessário.
 */
export async function startExtraction(page: Page) {
  const extract = page.getByRole("button", { name: "Extrair", exact: true });
  const auto = page.getByText("Abaixo do limite de confirmação: a extração começa sozinha.");
  await expect(async () => {
    if (/\/onboarding\/3$/.test(page.url())) return;
    if (await auto.isVisible()) throw new Error("autoconfirmação em andamento");
    await extract.click({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expectStep(page, 3);
}

/** Passo 3: espera as etapas terminarem e segue para a revisão. */
export async function waitExtractionDone(page: Page, timeout = 120_000) {
  await expect(page.getByText("Extração concluída.")).toBeVisible({ timeout });
  await page.getByRole("button", { name: "Revisar o que foi extraído" }).click();
  await expectStep(page, 4);
}

export const phone = (page: Page) => ({
  country: page.locator("#phone-country"),
  area: page.locator("#phone-area"),
  number: page.locator("#phone-number"),
});

export async function fillPhone(page: Page, area = "11", number = "987654321") {
  await phone(page).area.fill(area);
  await phone(page).number.fill(number);
}

/** Preenche a identidade mínima quando não há currículo (passo 4 em branco). */
export async function fillIdentityBlank(page: Page, opts: { phone?: boolean } = {}) {
  await page.locator("#displayName").fill("Bia");
  await page.locator("#fullName").fill("Beatriz Exemplo");
  await page.locator("#email").fill("bia.exemplo@example.com");
  await page.locator("#city").fill("Curitiba");
  await page.locator("#timezone").fill("America/Sao_Paulo");
  if (opts.phone !== false) await fillPhone(page, "41", "999990000");
}

/** Passo 4 → 5 aceitando todas as propostas (identidade já vinda do currículo). */
export async function acceptAllAndNext(page: Page) {
  await page.getByRole("button", { name: "Aceitar todos" }).click();
  await expect(page.getByText("Tudo revisado.")).toBeVisible();
  await page.getByRole("button", { name: "Avançar" }).click();
  await expectStep(page, 5);
}

export interface ProfileOpts {
  name?: string;
  title?: string;
  area?: string;
  salary?: { min: string; max: string; currency?: string } | "dontKnow" | "skip";
}

/** Passo 5: preenche o que falta e cria o perfil; devolve quando o dashboard abrir. */
export async function fillProfileAndCreate(page: Page, opts: ProfileOpts = {}) {
  if (opts.name) await page.locator("#pname").fill(opts.name);
  if (opts.title) await page.locator("#ptitle").fill(opts.title);
  if (opts.area) await page.locator("#parea").fill(opts.area);
  const salary = opts.salary ?? { min: "9000", max: "12000" };
  if (salary === "dontKnow") {
    await page.getByLabel("Não sei").first().check();
  } else if (salary !== "skip") {
    await page.getByLabel("Mínimo").fill(salary.min);
    await page.getByLabel("Máximo").fill(salary.max);
    if (salary.currency) await page.getByLabel("Moeda").selectOption(salary.currency);
  }
  await page.getByLabel("CLT", { exact: true }).check();
  if (salary === "skip") {
    await page.getByRole("button", { name: "Criar perfil e continuar" }).click();
    return;
  }
  await submitProfileAndSkipDiscovery(page);
}

/**
 * Passo 5 → 6 (auditoria E2): cria o perfil, pula a entrevista de descoberta (opcional) e espera o dashboard.
 */
export async function submitProfileAndSkipDiscovery(page: Page) {
  await page.getByRole("button", { name: "Criar perfil e continuar" }).click();
  await expectStep(page, 6);
  await page.getByRole("button", { name: "Pular e ir ao dashboard" }).click();
  await expectDashboard(page);
}

export async function expectDashboard(page: Page) {
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

export async function statValue(page: Page, key: "experiences" | "skills" | "education" | "files") {
  const text = await page.getByTestId(`stat-${key}`).locator("span").last().textContent();
  return Number(text);
}

/** Caminho completo com currículo até o passo 5 (usado por vários cenários). */
export async function reachProfileStep(page: Page, file = "cv_text.pdf") {
  await openApp(page);
  await passProvider(page);
  await chooseFile(page, file);
  await startExtraction(page);
  await waitExtractionDone(page);
  await acceptAllAndNext(page);
}
