import { expect, test } from "@playwright/test";
import { createSession } from "../helpers/chat";
import { freshStart, getRun, listRuns, notifications } from "../helpers/ingest";
import { login } from "../helpers/profiles";

/**
 * Alteração pequena pedida na conversa (pedido do dono, 2026-10-23): o recrutador propõe com `fact_propose_change`,
 * o cartão com o antes e o depois aparece no painel da conversa, a pendência fica em Pendências enquanto o usuário não
 * decide, e só confirmar muda o dado.
 */
test("F04/E2E-21 alteração pela conversa: cartão no painel, pendência e confirmação", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const s = await createSession({ profileId: ids.profileId, title: "Correção" });
  await login(page, `/chat/${s.id}`);
  await page
    .getByRole("textbox", { name: "Mensagem para o recrutador" })
    .fill(
      "Meu cargo na Acme Pagamentos era Tech Lead, não Engenheira de Software Sênior. Corrige aí?",
    );
  await page.getByRole("button", { name: "Enviar" }).click();

  const panel = page.getByRole("region", { name: "Ingestão da conversa" });
  const card = panel.getByRole("region", { name: "O recrutador quer alterar um dado seu" });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByRole("row", { name: "Cargo" })).toContainText("Tech Lead");
  await expect(card.getByText("Conferido nas suas mensagens")).toBeVisible();
  // a própria conversa pediu: não chega a nota de "ingestão pronta"
  const messages = page.getByRole("list", { name: "Mensagens" });
  await expect(messages.getByText(/Ingestão pronta/)).toHaveCount(0);

  // sem decidir na conversa, fica em Pendências
  const run = (await listRuns()).runs.find((r) => r.source === "text");
  if (!run) throw new Error("a alteração não criou a execução");
  expect((await notifications("open")).notifications.map((n) => n.title)).toContainEqual(
    expect.stringMatching(/O recrutador quer alterar um dado seu/),
  );
  await page.goto("/pendencias");
  const item = page.getByRole("listitem", { name: /O recrutador quer alterar um dado seu/ });
  await expect(item).toBeVisible();
  await item.getByRole("link", { name: "Ir para resolver" }).click();
  await page.waitForURL(`**/ingestao/${run.id}`);
  const onPage = page.getByRole("region", { name: "O recrutador quer alterar um dado seu" });
  await onPage.getByRole("button", { name: "Confirmar alteração" }).click();
  await expect(onPage.getByText("Alteração confirmada.")).toBeVisible();
  await expect.poll(async () => (await getRun(run.id)).status).toBe("done");
  const open = (await notifications("open")).notifications.filter((n) => n.subjectId === run.id);
  expect(open.filter((n) => n.kind === "review.pending")).toHaveLength(0);
});
