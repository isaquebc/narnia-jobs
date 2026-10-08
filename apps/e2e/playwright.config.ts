import { defineConfig, devices } from "@playwright/test";

/**
 * Suíte e2e do F01 (um cenário por arquivo, títulos `F01/E2E-xx`). Roda dentro do container Playwright do
 * `docker-compose.e2e.yml`, na rede do compose: a UI é `http://web` (nginx) e a API é alcançada pelo mesmo host.
 * O backend é compartilhado entre os cenários, então eles rodam em série e cada um começa com `POST /api/_test/reset`.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "report", open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.BASE_URL ?? "http://web",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 900 },
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
