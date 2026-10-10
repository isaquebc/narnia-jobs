import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { api } from "../helpers/api";
import { openApp } from "../helpers/flows";
import { finishByRejecting, freshStart, runGithubToReview } from "../helpers/ingest";

const TOKEN_RE = /\b(gh[opsur]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/;

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}

test("F03/E2E-13 configurações persistem; nenhum token do GitHub em respostas ou logs", async ({
  page,
}) => {
  await freshStart("engineer");
  await openApp(page);
  await page.goto("/configuracoes");
  const reviewer = page.getByRole("switch", {
    name: "Revisor anti-alucinação (modelo mais barato)",
  });
  await expect(reviewer).toBeChecked();
  await reviewer.click();
  await page.getByLabel("Seguir sozinho abaixo de (mil tokens)").fill("5");
  await page.getByRole("button", { name: "Salvar configurações" }).click();
  await expect(page.getByText("Configurações salvas.")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("switch", { name: "Revisor anti-alucinação (modelo mais barato)" }),
  ).not.toBeChecked();
  await expect(page.getByLabel("Seguir sozinho abaixo de (mil tokens)")).toHaveValue("5");

  const runId = await runGithubToReview(["ana-exemplo/api-pagamentos"]);
  await finishByRejecting(runId);
  for (const path of [
    "/api/github/auth",
    "/api/settings/ingest",
    `/api/ingestions/${runId}`,
    "/api/repos",
    "/api/notifications?status=all",
    "/api/snapshots",
  ]) {
    expect(JSON.stringify(await api(path))).not.toMatch(TOKEN_RE);
  }
  // logs e snapshots da stack e2e (montados só leitura em /data no container do Playwright)
  for (const f of filesUnder("/data").filter((p) => /\/(logs|snapshots)\//.test(p))) {
    expect(readFileSync(f, "utf8"), f).not.toMatch(TOKEN_RE);
  }
});
