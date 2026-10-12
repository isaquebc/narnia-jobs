import { expect, test } from "@playwright/test";
import { api } from "../helpers/api";
import { freshStart, STORY, startTextRun, waitRun } from "../helpers/ingest";
import { login } from "../helpers/profiles";

test("F04/E2E-06 clarificação: a partir da revisão, a resposta vira proposta na mesma execução", async ({
  page,
}) => {
  await freshStart("engineer");
  const runId = await startTextRun(`${STORY} Clarificação do E2E-06.`);
  await waitRun(runId, ["review"]);
  const before = (await api<{ proposals: unknown[] }>(`/api/ingestions/${runId}/proposals`))
    .proposals.length;

  await login(page, `/ingestao/${runId}`);
  await page.getByRole("button", { name: "Clarificar com o recrutador" }).click();
  await expect(
    page.getByText(new RegExp(`Clarificando ingestão ${runId.slice(0, 8)}`)),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Mensagem para o recrutador" })
    .fill("Também conduzi as reuniões com o time comercial.");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(
    page.getByRole("list", { name: "Mensagens" }).getByText(/Anotei a correção/),
  ).toBeVisible({ timeout: 60_000 });

  await expect
    .poll(
      async () =>
        (await api<{ proposals: unknown[] }>(`/api/ingestions/${runId}/proposals`)).proposals
          .length,
    )
    .toBe(before + 1);
  await page.getByRole("link", { name: "Ir para a revisão" }).click();
  await expect(page.getByText("Comunicação com stakeholders")).toBeVisible();
});
