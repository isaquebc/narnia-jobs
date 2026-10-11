import { expect, test } from "@playwright/test";
import { jobs, reset, setMock, waitFor } from "../helpers/api";
import { chooseFile, expectStep, openApp, passProvider, startExtraction } from "../helpers/flows";

test("F01/E2E-11 job em segundo plano: menu só com Primeiro uso, progresso pela bandeja e retomada do wizard", async ({
  page,
}) => {
  await reset();
  await openApp(page);
  await passProvider(page);
  // o atraso vem antes do envio: abaixo do limiar a extração começa sozinha (F03-13 no onboarding)
  await setMock({ delayMs: 10_000 });
  await chooseFile(page, "cv.docx");
  await startExtraction(page);

  // antes de concluir o primeiro uso, o menu só oferece "Primeiro uso" (pedido do dono, 2026-10-11)
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("link", { name: "Primeiro uso" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
  const count = page.getByTestId("activity-count");
  await expect(count).not.toHaveText("0");
  await page.getByRole("button", { name: "Atividades" }).click();
  const tray = page.getByRole("region", { name: "Atividades" });
  await expect(tray.getByText("Extração de fatos")).toBeVisible();
  await expect(tray.getByText(/Rodando|Na fila/).first()).toBeVisible();

  await waitFor(jobs, (j) => j.jobs.length > 0 && j.jobs.every((x) => x.status === "done"), {
    timeoutMs: 90_000,
    label: "jobs concluídos",
  });
  await expect(count).toHaveText("0", { timeout: 15_000 });
  await expect(tray.getByText("Concluída").first()).toBeVisible();

  await openApp(page);
  await expectStep(page, 3);
  await expect(page.getByText("Extração concluída.")).toBeVisible();
});
