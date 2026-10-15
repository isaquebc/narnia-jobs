import { expect, test } from "@playwright/test";
import { freshStart } from "../helpers/ingest";
import { addNote, getPosting, intake, mcpCall } from "../helpers/postings";
import { login } from "../helpers/profiles";

test("F06/E2E-04 notas: o recrutador altera uma nota do usuário, a bandeja mostra 'Aguardando você' e confirmar aplica", async ({
  page,
}) => {
  await freshStart("engineer");
  const p = await intake({ fields: { company: "Nubank", role: "backend" } });
  const note = await addNote(p.id, "Falei com a Joana dia 10");
  const r = await mcpCall<{ pending: boolean }>("posting_note_update", {
    id: note.id,
    body: "Falei com a Joana dia 10; ela pediu portfólio",
  });
  expect(r.pending).toBe(true);
  await login(page, "/vagas");
  await page.getByRole("button", { name: "Atividades" }).click();
  const waiting = page.getByRole("list", { name: "Aguardando você" });
  await expect(waiting).toContainText("Alteração de nota em Nubank");
  await waiting.getByRole("link", { name: "revisar" }).click();
  const pending = page.getByRole("region", { name: "O recrutador quer alterar esta nota" });
  await expect(pending).toContainText("pediu portfólio");
  await pending.getByRole("button", { name: "Confirmar alteração" }).click();
  await expect(pending).toHaveCount(0);
  const after = await getPosting(p.id);
  expect(after.notes[0]).toMatchObject({
    body: "Falei com a Joana dia 10; ela pediu portfólio",
    pendingBody: null,
  });
  // a pendência também saiu de Pendências
  await page.goto("/pendencias");
  await expect(page.getByText(/O recrutador quer alterar uma nota/)).toHaveCount(0);
});
