import { expect, test } from "@playwright/test";
import { freshStart } from "../helpers/ingest";
import { analyses, analyze, intake, JD } from "../helpers/postings";
import { login, patchFact } from "../helpers/profiles";

test("F06/E2E-05 reanalisar: fato novo deixa a análise desatualizada; reanalisar abre outra conversa da vaga", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const p = await intake({ text: JD });
  await analyze(p.id);
  await expect.poll(async () => (await analyses(p.id)).length, { timeout: 20_000 }).toBe(1);
  await patchFact("skill", ids.skillIds[0] as string, { level: 5 });
  await login(page, `/vagas/${p.id}`);
  await expect(page.getByText(/Seus dados ou a vaga mudaram/)).toBeVisible();
  await page.getByRole("button", { name: "Reanalisar" }).first().click();
  await expect(page).toHaveURL(/\/chat\/[^/]+$/);
  await expect.poll(async () => (await analyses(p.id)).length, { timeout: 20_000 }).toBe(2);
  expect((await analyses(p.id))[0]?.stale).toEqual({ facts: false, posting: false });
});
