import { expect, test } from "@playwright/test";
import { openApp } from "../helpers/flows";
import {
  confirmRun,
  createGithubRun,
  freshStart,
  STORY,
  setMockF03,
  startTextRun,
  waitRun,
} from "../helpers/ingest";

test("F03/E2E-08 duas ingestões simultâneas: GitHub e texto livre aparecem juntas e chegam à revisão", async ({
  page,
}) => {
  await freshStart("engineer");
  await setMockF03({ delayMs: 1_500 });
  const gh = await createGithubRun({
    repos: ["ana-exemplo/api-pagamentos", "ana-exemplo/painel-web"],
  });
  await confirmRun(gh);
  const text = await startTextRun(STORY);

  await openApp(page);
  await page.goto("/ingestao");
  const list = page.getByRole("list", { name: "Execuções em andamento e pendentes" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await Promise.all([waitRun(gh, ["review"], 120_000), waitRun(text, ["review"], 120_000)]);
  await setMockF03({ delayMs: 0 });
  await page.reload();
  await expect(list.getByRole("listitem")).toHaveCount(2);
});
