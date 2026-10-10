import { expect, test } from "@playwright/test";
import { fixture } from "../helpers/flows";
import { freshStart, getRun, notifications, openIngestion, waitRun } from "../helpers/ingest";

test("F03/E2E-05 re-ingestão de CV com conflito: notificação, salvar bloqueado, manter atual, concluída", async ({
  page,
}) => {
  await freshStart("engineer");
  await openIngestion(page);
  await page.getByRole("tab", { name: "Currículo" }).click();
  await page.locator('input[type="file"]').setInputFiles(fixture("cv_text.pdf"));
  // abaixo de 10 mil tokens segue sozinho (F03-13) e abre a execução
  await expect(page).toHaveURL(/\/ingestao\/[\w-]+$/, { timeout: 30_000 });
  const runId = page.url().split("/").pop() as string;
  await waitRun(runId, ["review"], 120_000);

  const open = await notifications("open");
  expect(
    open.notifications.some((n) => n.kind === "review.conflicts" && n.subjectId === runId),
  ).toBe(true);

  const review = page.getByRole("region", { name: "Revisão" });
  await expect(review.getByText("Conflito").first()).toBeVisible({ timeout: 30_000 });
  await review.getByRole("button", { name: "Aceitar todos" }).click();
  // salvar fica bloqueado enquanto houver conflito aceito sem resolução
  await expect(review.getByRole("button", { name: "Salvar revisão" })).toBeDisabled();
  await expect(review.getByText("Resolva os conflitos aceitos antes de salvar.")).toBeVisible();
  expect((await getRun(runId)).status).toBe("review");

  const groups = review.getByRole("group", { name: /^Resolver: / });
  const n = await groups.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++)
    await groups
      .nth(i)
      .getByRole("radio", { name: /^Manter atual/ })
      .check();
  await expect(review.getByRole("button", { name: "Salvar revisão" })).toBeEnabled();
  await review.getByRole("button", { name: "Salvar revisão" }).click();
  await waitRun(runId, ["done"]);
  const after = await notifications("open");
  const mine = after.notifications.filter((x) => x.subjectId === runId).map((x) => x.kind);
  // revisão e conflitos resolvidos sozinhos; "concluída" é informativa (FX-3): fora do contador do sino e
  // resolvida quando a página da execução, aberta aqui, é recarregada
  expect(mine.filter((k) => k !== "ingestion.done")).toEqual([]);
  expect(after.unresolved).toBe(0);
});
