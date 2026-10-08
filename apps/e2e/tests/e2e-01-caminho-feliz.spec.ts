import { expect, test } from "@playwright/test";
import { dashboard, reset, user } from "../helpers/api";
import {
  acceptAllAndNext,
  chooseFile,
  fillProfileAndCreate,
  openApp,
  passProvider,
  phone,
  startExtraction,
  statValue,
  waitExtractionDone,
} from "../helpers/flows";

test("F01/E2E-01 caminho feliz com CV: upload, estimativa, extração, revisão, perfil e dashboard", async ({
  page,
}) => {
  await reset();
  await openApp(page);
  await expect(page.getByText("Logado pela assinatura (login no container)").first()).toBeVisible();
  await passProvider(page);

  await chooseFile(page, "cv_text.pdf");
  await expect(page.getByText(/Extração de fatos: ~.* tokens/)).toBeVisible();
  await startExtraction(page);
  await expect(page.getByText(/Etapa \d de \d/)).toBeVisible();
  await waitExtractionDone(page);

  await expect(page.getByRole("heading", { name: "Experiências" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Skills" })).toBeVisible();
  const rows = page.locator('[data-testid^="proposal-"]');
  await expect(rows).toHaveCount(15);
  await expect(page.getByText("Acme Ltda", { exact: false }).first()).toBeVisible();
  expect(
    await page.getByText(/^(Go|Kubernetes|PostgreSQL|Docker|Terraform)$/).count(),
  ).toBeGreaterThanOrEqual(3);

  await expect(page.locator("#fullName")).toHaveValue("Ana Maria Exemplo");
  await expect(page.locator("#email")).toHaveValue("ana.exemplo@example.com");
  await expect(phone(page).area).toHaveValue("11");
  await expect(phone(page).number).toHaveValue("987654321");
  await expect(page.getByText("do currículo").first()).toBeVisible();

  await acceptAllAndNext(page);
  await expect(page.locator("#ptitle")).toHaveValue("Engenheira de Software Sênior");
  await expect(page.getByText(/Sugerido porque:/)).toBeVisible();
  await fillProfileAndCreate(page);

  await expect(page.getByText("Olá, Ana")).toBeVisible();
  await expect(page.getByText("Engenheira de Software Sênior").first()).toBeVisible();
  expect(await statValue(page, "experiences")).toBe(2);
  expect(await statValue(page, "skills")).toBe(6);
  expect(await statValue(page, "education")).toBe(1);
  expect(await statValue(page, "files")).toBe(1);

  const d = await dashboard();
  expect(d.counts).toMatchObject({ experiences: 2, skills: 6, education: 1, files: 1 });
  expect((await user()).user?.phone.e164).toBe("+5511987654321");
});
