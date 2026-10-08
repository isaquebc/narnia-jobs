import { existsSync, readdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { dashboard, onboarding, reset } from "../helpers/api";
import {
  expectDashboard,
  fillProfileAndCreate,
  openApp,
  reachProfileStep,
  statValue,
} from "../helpers/flows";

/**
 * @ops: o lançador (start.sh e2e) roda a parte 1, faz `docker compose down` + `up` e então roda a parte 2.
 * A pasta de dados da stack (./.e2e-data) está montada em /data (somente leitura) neste container.
 */
test.describe("F01/E2E-06 persistência @ops", () => {
  test("F01/E2E-06 persistência @ops · parte 1: concluir o onboarding com upload", async ({
    page,
  }) => {
    await reset();
    await reachProfileStep(page, "cv_text.pdf");
    await fillProfileAndCreate(page);
    expect((await onboarding()).completed).toBe(true);
    expect((await dashboard()).counts.files).toBe(1);
  });

  test("F01/E2E-06 persistência @ops · parte 2: depois de down/up o dashboard e o upload continuam lá", async ({
    page,
  }) => {
    expect((await onboarding()).completed).toBe(true);
    await openApp(page);
    await expectDashboard(page);
    await expect(page.getByText("Olá, Ana")).toBeVisible();
    expect(await statValue(page, "experiences")).toBe(2);
    expect(await statValue(page, "files")).toBe(1);
    expect(existsSync("/data/uploads")).toBe(true);
    expect(readdirSync("/data/uploads").filter((f) => f.endsWith(".pdf"))).toHaveLength(1);
    expect(existsSync("/data/narnia.sqlite")).toBe(true);
  });
});
