import { expect, test } from "@playwright/test";
import { api } from "../helpers/api";
import { openApp } from "../helpers/flows";
import { freshStart, getRun, runGithubToReview, waitRun } from "../helpers/ingest";
import { listEmphasis, listProfiles } from "../helpers/profiles";

test("F03/E2E-09 tags por perfil: projeto aceito marcando só um perfil vira ênfase só nele", async ({
  page,
}) => {
  await freshStart("engineer");
  const eng = (await listProfiles()).profiles[0] as { id: string };
  const full = await api<Record<string, unknown>>(`/api/profiles/${eng.id}`);
  const keep = [
    "targetTitle",
    "seniority",
    "area",
    "goal",
    "market",
    "docLocale",
    "salary",
    "contractTypes",
    "locations",
    "availableFrom",
    "needsResearch",
  ];
  const body = Object.fromEntries(Object.entries(full).filter(([k]) => keep.includes(k)));
  const pm = await api<{ id: string }>("/api/profiles", {
    method: "POST",
    body: JSON.stringify({
      ...body,
      name: "Project Manager",
      targetTitle: "Project Manager",
      altTitles: [],
    }),
  });

  const runId = await runGithubToReview(["ana-exemplo/api-pagamentos"]);
  const run = await getRun(runId);
  expect(run.proposals.some((p) => p.proposal.kind === "project")).toBe(true);

  await openApp(page);
  await page.goto(`/ingestao/${runId}`);
  const review = page.getByRole("region", { name: "Revisão" });
  await expect(review).toBeVisible();
  const rows = review
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Aceitar" }) });
  const total = await rows.count();
  let tagged = false;
  for (let i = 0; i < total; i++) {
    const row = rows.nth(0); // a linha decidida sai do filtro
    const tag = row.getByRole("checkbox", { name: "Destacar em Project Manager" });
    const isProject =
      !tagged && (await row.getAttribute("aria-label"))?.toLowerCase().includes("api-pagamentos");
    if (isProject && (await tag.count()) > 0) {
      await tag.check();
      await row.getByRole("button", { name: "Aceitar" }).click();
      tagged = true;
    } else {
      await row.getByRole("button", { name: "Rejeitar" }).click();
    }
  }
  expect(tagged).toBe(true);
  await review.getByRole("button", { name: "Salvar revisão" }).click();
  await waitRun(runId, ["done"]);

  const isProject = (r: { kind: string; mode: string }) =>
    r.kind === "project" && r.mode === "highlight";
  expect((await listEmphasis(pm.id)).items.some(isProject)).toBe(true);
  expect((await listEmphasis(eng.id)).items.some(isProject)).toBe(false);
});
