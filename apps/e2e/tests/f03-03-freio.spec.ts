import { expect, test } from "@playwright/test";
import { openApp } from "../helpers/flows";
import {
  confirmRun,
  createGithubRun,
  freshStart,
  getRun,
  notifications,
  waitRun,
} from "../helpers/ingest";

const REPOS = [
  "ana-exemplo/api-pagamentos",
  "ana-exemplo/painel-web",
  "ana-exemplo/cli-relatorios",
];

test("F03/E2E-03 freio de orçamento: notificação, diálogo, deixar para depois, pendências, continuar", async ({
  page,
}) => {
  await freshStart("engineer");
  const runId = await createGithubRun({ repos: REPOS, budget: { amount: 50, unit: "thousand" } });
  await confirmRun(runId);
  await waitRun(runId, ["awaiting_decision"]);

  await openApp(page);
  await expect(page.getByTestId("notifications-count")).toBeVisible();
  await page.goto(`/ingestao/${runId}`);
  const dialog = page.getByRole("dialog", { name: "Orçamento esgotado" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Gasto: .* · estimado: /)).toBeVisible();
  await expect(dialog.getByText(/Para terminar: ~/)).toBeVisible();
  await dialog.getByRole("button", { name: "Deixar para depois" }).click();
  await waitRun(runId, ["paused"]);

  // fica em Pendências até ser finalizada
  await page.goto("/pendencias");
  const waiting = page.getByRole("list", { name: "Aguardando sua decisão" });
  await expect(waiting.getByRole("listitem")).toHaveCount(1);
  await waiting.getByRole("link", { name: "Ir para resolver" }).click();
  await expect(page).toHaveURL(new RegExp(`/ingestao/${runId}$`));

  await page.getByRole("button", { name: "Retomar" }).click();
  const again = page.getByRole("dialog", { name: "Orçamento esgotado" });
  await again.getByLabel("Orçamento extra (mil tokens)").fill("200");
  await again.getByRole("button", { name: "Continuar" }).click();
  await waitRun(runId, ["review"]);
  const run = await getRun(runId);
  expect(run.report?.repos.every((r) => r.status === "done")).toBe(true);

  const open = await notifications("open");
  expect(open.notifications.some((n) => n.kind === "ingestion.awaiting_decision")).toBe(false);
  expect(open.notifications.some((n) => n.kind === "review.pending" && n.subjectId === runId)).toBe(
    true,
  );
});

test("F03/E2E-03b freio: encerrar com o que já foi feito leva à revisão com os pendentes pulados", async () => {
  await freshStart("engineer");
  const runId = await createGithubRun({ repos: REPOS, budget: { amount: 50, unit: "thousand" } });
  await confirmRun(runId);
  await waitRun(runId, ["awaiting_decision"]);
  const { api } = await import("../helpers/api");
  await api(`/api/ingestions/${runId}/decision`, {
    method: "POST",
    body: JSON.stringify({ action: "finish" }),
  });
  await waitRun(runId, ["review"]);
  const run = await getRun(runId);
  expect(run.report?.repos.some((r) => r.status !== "done")).toBe(true);
});
