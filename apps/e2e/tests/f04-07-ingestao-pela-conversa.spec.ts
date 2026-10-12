import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { BASE_URL, TOKEN } from "../helpers/api";
import { createSession, say } from "../helpers/chat";
import { fixture } from "../helpers/flows";
import { freshStart, getRun, listRuns, STORY, waitRun } from "../helpers/ingest";
import { login } from "../helpers/profiles";

test("F04/E2E-07 ingestão pela conversa: texto pela tela com link para a execução, arquivo anexado e GitHub com confirmação", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const s = await createSession({ profileId: ids.profileId, title: "Ingerir" });

  // texto pela tela: o recrutador cria a execução e a mensagem ganha o link (nada é gravado direto)
  await login(page, `/chat/${s.id}`);
  await page
    .getByRole("textbox", { name: "Mensagem para o recrutador" })
    .fill(`texto: ${STORY} Isto veio pelo chat do E2E-07.`); // mínimo de 200 caracteres da ingestão de texto
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByRole("link", { name: "Abrir a ingestão criada" }).first()).toBeVisible({
    timeout: 60_000,
  });
  const textRun = (await listRuns()).runs.find((r) => r.source === "text");
  if (!textRun) throw new Error("execução de texto não criada pela conversa");
  await waitRun(textRun.id, ["review"]);
  // auditoria D: o link aponta para a execução criada pela própria conversa e sobrevive ao reload (runId na tool call)
  await page.reload();
  const link = page.getByRole("link", { name: "Abrir a ingestão criada" });
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute("href", `/ingestao/${textRun.id}`);

  // arquivo: upload pela api (o chat recebe o id) → ingest_file
  const form = new FormData();
  form.append(
    "file",
    new Blob([await readFile(fixture("cv_text.pdf"))], { type: "application/pdf" }),
    "cv_text.pdf",
  );
  const up = await fetch(`${BASE_URL}/api/files`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: form,
  });
  const file = (await up.json()) as { id: string };
  await say(s.id, `arquivo: ${file.id}`);
  await expect
    .poll(async () => (await listRuns()).runs.filter((r) => r.source === "cv").length)
    .toBeGreaterThan(0);

  // GitHub: prepara e para em "aguardando confirmação" (GitHub sempre confirma, F03-13)
  await say(s.id, "github: ana-exemplo/api-pagamentos");
  await expect
    .poll(async () => (await listRuns()).runs.some((r) => r.source === "github"))
    .toBe(true);
  const gh = (await listRuns()).runs.find((r) => r.source === "github");
  if (!gh) throw new Error("execução do GitHub não criada pela conversa");
  await waitRun(gh.id, ["awaiting_confirmation"]);
  expect((await getRun(gh.id)).status).toBe("awaiting_confirmation");
});
