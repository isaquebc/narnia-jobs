import { expect, test } from "@playwright/test";
import { ingestion, onboarding, reset } from "../helpers/api";
import {
  acceptAllAndNext,
  chooseFile,
  fillProfileAndCreate,
  openApp,
  passProvider,
  startExtraction,
  waitExtractionDone,
} from "../helpers/flows";

test("F01/E2E-17 PDF escaneado: OCR e leitura pelo modelo rodam; revisão mostra origem por trecho e divergências", async ({
  page,
}) => {
  await reset();
  await openApp(page);
  await passProvider(page);
  await chooseFile(page, "cv_scan.pdf");
  await startExtraction(page);
  await expect(page.getByText("OCR das páginas")).toBeVisible();
  await expect(page.getByText("Leitura do documento pelo modelo")).toBeVisible();
  await waitExtractionDone(page);

  const runId = (await onboarding()).runId as string;
  const run = await ingestion(runId);
  const kinds = run.readings.map((r) => r.kind);
  expect(kinds).toContain("ocr");
  expect(kinds).toContain("model_read");
  expect(run.readings.find((r) => r.kind === "ocr")?.quality ?? 0).toBeGreaterThan(0.5);
  const origins = new Set(run.proposals.map((p) => p.origin).filter(Boolean));
  expect(origins.size).toBeGreaterThan(0);
  expect(run.segments.length).toBeGreaterThan(0);
  expect(
    run.segments.some(
      (s) => s.agreement < 1 || (Array.isArray(s.divergences) && s.divergences.length > 0),
    ),
  ).toBe(true);

  const badges = page.getByText(/^(OCR|leitura pelo modelo|consolidado|camada de texto)$/);
  expect(await badges.count()).toBeGreaterThan(0);
  await acceptAllAndNext(page);
  await fillProfileAndCreate(page);
});
