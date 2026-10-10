import { expect, test } from "@playwright/test";
import { openApp } from "../helpers/flows";
import {
  confirmRun,
  createGithubRun,
  finishByRejecting,
  freshStart,
  runGithubToReview,
  setGithub,
  waitRun,
} from "../helpers/ingest";

const REPO = "ana-exemplo/api-pagamentos";

test("F03/E2E-11 snapshot sem rede: re-rodar com o GitHub inacessível usa o que já foi lido", async ({
  page,
}) => {
  await freshStart("engineer");
  await finishByRejecting(await runGithubToReview([REPO]));

  await setGithub({ offline: true });
  try {
    const again = await createGithubRun({ repos: [REPO] });
    await confirmRun(again);
    await waitRun(again, ["review"]);
  } finally {
    await setGithub({ offline: false });
  }

  await openApp(page);
  await page.goto("/configuracoes");
  const snaps = page.getByRole("region", { name: "Snapshots" });
  await expect(snaps.getByText(/Em uso: /)).toBeVisible();
  await expect(snaps.getByRole("button", { name: `Apagar snapshot de ${REPO}` })).toBeVisible();
});
