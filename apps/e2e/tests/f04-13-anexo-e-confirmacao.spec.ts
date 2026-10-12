import { expect, test } from "@playwright/test";
import { setAutoConfirmBelow } from "../helpers/api";
import { createSession } from "../helpers/chat";
import { fixture } from "../helpers/flows";
import { freshStart, getRun, listRuns, waitRun } from "../helpers/ingest";
import { login } from "../helpers/profiles";

test("F04/E2E-13 anexo no chat: o arquivo sobe pelo composer, o recrutador abre a ingestão e, acima do limite, ela espera a confirmação na conversa", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  // auditoria E1: o limite de custo da tela vale para a conversa; com 1 token, toda ingestão pede confirmação
  await setAutoConfirmBelow(1);
  const s = await createSession({ profileId: ids.profileId, title: "Anexo" });
  await login(page, `/chat/${s.id}`);

  await page.getByLabel("Anexar arquivo").setInputFiles(fixture("cv_text.pdf"));
  const list = page.getByRole("list", { name: "Mensagens" });
  // a bolha mostra o anexo como chip, sem o marcador cru
  await expect(list.getByText("cv_text.pdf").first()).toBeVisible({ timeout: 60_000 });
  await expect(list.getByText(/fileId/)).toHaveCount(0);

  await expect(page.getByText(/Aguardando sua confirmação/)).toBeVisible({ timeout: 60_000 });
  const run = (await listRuns()).runs.find((r) => r.source === "cv");
  if (!run) throw new Error("execução do anexo não criada pela conversa");
  expect((await getRun(run.id)).status).toBe("awaiting_confirmation");

  await page.getByRole("button", { name: "Confirmar ingestão" }).click();
  await waitRun(run.id, ["review"]);
  await expect(page.getByRole("button", { name: "Confirmar ingestão" })).toHaveCount(0);
});
