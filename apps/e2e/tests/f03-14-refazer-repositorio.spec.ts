import { expect, test } from "@playwright/test";
import { openApp } from "../helpers/flows";
import {
  confirmRun,
  createGithubRun,
  freshStart,
  getRun,
  listRuns,
  setGithub,
  waitRun,
} from "../helpers/ingest";

/** Plano de comunicação C4 (CM3): repositório que falhou é refeito na mesma execução, sem criar outra. */
test("F03/E2E-14 repositório falho refeito na mesma execução", async ({ page }) => {
  await freshStart("engineer");
  await setGithub({ failRepos: ["ana-exemplo/notas-privadas"] });
  const runId = await createGithubRun({
    repos: ["ana-exemplo/api-pagamentos", "ana-exemplo/notas-privadas"],
  });
  await confirmRun(runId);
  await waitRun(runId, ["review"]);

  // o GitHub volta a responder e o dono refaz só o repositório que falhou, pela própria linha
  await setGithub({ failRepos: [] });
  await openApp(page);
  await page.goto(`/ingestao/${runId}`);
  const rows = page.getByRole("list", { name: "Repositórios da execução" });
  const failed = rows.getByRole("listitem").filter({ hasText: "ana-exemplo/notas-privadas" });
  await expect(failed.getByText(/^Falhou/)).toBeVisible();
  await failed.getByRole("button", { name: "Tentar este repositório de novo" }).click();

  await waitRun(runId, ["review"]);
  const run = await getRun(runId);
  expect(run.report?.repos.map((r) => [r.fullName, r.status]).sort()).toEqual([
    ["ana-exemplo/api-pagamentos", "done"],
    ["ana-exemplo/notas-privadas", "done"],
  ]);
  // nenhuma execução nova foi criada
  const runs = await listRuns();
  expect(runs.runs.filter((r) => r.source === "github").map((r) => r.id)).toEqual([runId]);
});
