import { expect, test } from "@playwright/test";
import { api } from "../helpers/api";
import { openApp } from "../helpers/flows";
import {
  confirmRun,
  finishByRejecting,
  freshStart,
  HEAD,
  runGithubToReview,
  setGithub,
  waitRun,
} from "../helpers/ingest";

const REPO = "ana-exemplo/api-pagamentos";

interface RepoDetail {
  repo: { id: string; headSha: string | null };
  analyses: Array<{ kind: string; headSha: string | null; baseSha: string | null }>;
}

async function reanalyzeFromUi(page: import("@playwright/test").Page, option: string) {
  await page.getByRole("button", { name: "Reanalisar" }).click();
  const dialog = page.getByRole("dialog", { name: `Reanalisar ${REPO}` });
  await expect(dialog.getByText(/Já lido:/)).toBeVisible();
  await dialog.getByRole("radio", { name: option }).check();
  await dialog.getByRole("button", { name: "Criar reanálise" }).click();
  await expect(page).toHaveURL(/\/ingestao\/[\w-]+$/);
  const runId = page.url().split("/").pop() as string;
  await waitRun(runId, ["awaiting_confirmation"]);
  await confirmRun(runId);
  await waitRun(runId, ["review"]);
  await finishByRejecting(runId);
  return runId;
}

test("F03/E2E-04 incremental: commit novo usa o diff; sem mudança, segunda rodada cobre o que ficou de fora", async ({
  page,
}) => {
  await freshStart("engineer");
  await finishByRejecting(await runGithubToReview([REPO]));
  const repos = await api<{ repos: Array<{ id: string; fullName: string }> }>("/api/repos");
  const repoId = repos.repos.find((r) => r.fullName === REPO)?.id as string;

  await setGithub({ heads: { [REPO]: HEAD("b") } });
  await openApp(page);
  await page.goto(`/evidencias/repositorios/${repoId}`);
  await reanalyzeFromUi(page, "Atualizar com os commits novos");
  let detail = await api<RepoDetail>(`/api/repos/${repoId}`);
  expect(detail.analyses[0]?.kind).toBe("incremental");
  expect(detail.analyses[0]?.headSha).toBe(HEAD("b"));
  expect(detail.analyses[0]?.baseSha).not.toBe(HEAD("b"));

  await page.goto(`/evidencias/repositorios/${repoId}`);
  await reanalyzeFromUi(page, "Cobrir o que ficou de fora");
  detail = await api<RepoDetail>(`/api/repos/${repoId}`);
  expect(detail.analyses[0]?.kind).toBe("cover");
  await page.goto(`/evidencias/repositorios/${repoId}`);
  await expect(
    page.getByRole("list", { name: "Histórico de análises" }).getByRole("listitem"),
  ).toHaveCount(3);
});
