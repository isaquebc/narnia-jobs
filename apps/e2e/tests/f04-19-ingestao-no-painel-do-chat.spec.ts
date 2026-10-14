import { expect, test } from "@playwright/test";
import { createSession } from "../helpers/chat";
import { freshStart, getRun, listRuns, STORY, waitRun } from "../helpers/ingest";
import { login } from "../helpers/profiles";

test("F04/E2E-19 ingestão pela conversa no painel: progresso, aviso do fim pelo sistema e revisão com salvar fixo", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const s = await createSession({ profileId: ids.profileId, title: "Painel" });
  await login(page, `/chat/${s.id}`);
  await page
    .getByRole("textbox", { name: "Mensagem para o recrutador" })
    .fill(`texto: ${STORY} Isto veio pelo painel do E2E-19.`);
  await page.getByRole("button", { name: "Enviar" }).click();

  // o card da ingestão aparece no painel da direita, separado do cartão do perfil
  const panel = page.getByRole("region", { name: "Ingestão da conversa" });
  await expect(panel).toBeVisible({ timeout: 60_000 });
  const run = (await listRuns()).runs.find((r) => r.source === "text");
  if (!run) throw new Error("execução de texto não criada pela conversa");
  await waitRun(run.id, ["review"]);

  // o fim do job chama o agente de novo: a conversa ganha a nota do sistema (sem o recrutador ficar esperando)
  const messages = page.getByRole("list", { name: "Mensagens" });
  await expect(messages.getByText(/Ingestão pronta: \d+ propostas? para revisar/)).toBeVisible({
    timeout: 60_000,
  });

  // revisão no próprio painel: cards empilhados; o espaço do salvar existe vazio até a primeira decisão
  const list = panel.getByRole("list", { name: "Propostas para revisar" });
  await expect(list.getByRole("listitem").first()).toBeVisible({ timeout: 30_000 });
  const slot = panel.getByTestId("review-save-slot");
  await expect(slot).toBeVisible();
  await expect(slot.getByRole("button", { name: "Salvar revisão" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Rejeitar todos" }).click();
  await slot.getByRole("button", { name: "Salvar revisão" }).click();
  await expect.poll(async () => (await getRun(run.id)).status, { timeout: 30_000 }).toBe("done");
  await expect(
    panel.getByText("Revisão salva. Os fatos aceitos já estão no perfil."),
  ).toBeVisible();

  // o link da ingestão vai na mensagem do recrutador que a abriu, não fixo acima do campo
  await expect(messages.getByRole("link", { name: "Abrir a ingestão criada" })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Abrir a ingestão criada" })).toHaveCount(1);

  // segunda ingestão na mesma conversa: card novo em cima; o anterior continua, finalizado
  await page
    .getByRole("textbox", { name: "Mensagem para o recrutador" })
    .fill(`texto: ${STORY} Segunda vez pelo painel do E2E-19.`);
  await page.getByRole("button", { name: "Enviar" }).click();
  const cards = page.getByRole("list", { name: "Ingestões da conversa" }).getByRole("listitem");
  await expect(cards).toHaveCount(2, { timeout: 60_000 });
  await expect(cards.nth(1).getByText("Finalizada")).toBeVisible();
  await expect(
    cards.nth(1).getByRole("link", { name: "Abrir a página da ingestão" }),
  ).toHaveAttribute("href", `/ingestao/${run.id}`);
  await expect(messages.getByRole("link", { name: "Abrir a ingestão criada" })).toHaveCount(2, {
    timeout: 60_000,
  });
});
