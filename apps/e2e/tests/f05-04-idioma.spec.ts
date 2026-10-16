import { expect, test } from "@playwright/test";
import { documents, waitDocuments } from "../helpers/documents";
import { freshStart } from "../helpers/ingest";
import { intake } from "../helpers/postings";
import { login, patchFact } from "../helpers/profiles";

const JD_EN = `Senior Backend Engineer
Company: Initech
Remote · Full time

Requirements:
- 5+ years with Node.js and TypeScript
- PostgreSQL and Kubernetes in production
- Docker in the day to day

Nice to have:
- AWS and Kafka

We are building the payment rails for the region and need an engineer who owns services end to end.`;

test("F05/E2E-04 idioma: vaga em inglês sem inglês fluente → pergunta; Parar não gera; Continuar gera em en-US", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  await patchFact("language", ids.languageIds[1] as string, { level: "A2" });
  const p = await intake({ text: JD_EN });
  await login(page, `/vagas/${p.id}`);
  await page.getByRole("button", { name: "Gerar" }).click();
  await page.getByRole("menuitem", { name: "CV" }).click();
  const dialog = page.getByRole("dialog", { name: "Gerar currículo" });
  await dialog.getByRole("button", { name: "Gerar" }).click();
  await expect(dialog.getByText(/não mostra inglês fluente/)).toBeVisible();
  await dialog.getByRole("button", { name: "Parar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await documents({ postingId: p.id })).toEqual([]);
  await page.getByRole("button", { name: "Gerar" }).click();
  await page.getByRole("menuitem", { name: "CV" }).click();
  await page
    .getByRole("dialog", { name: "Gerar currículo" })
    .getByRole("button", { name: "Gerar" })
    .click();
  await page.getByRole("button", { name: "Continuar mesmo assim" }).click();
  const [doc] = await waitDocuments({ postingId: p.id });
  expect(doc?.document.locale).toBe("en-US");
});
