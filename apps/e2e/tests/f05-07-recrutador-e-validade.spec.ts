import { expect, test } from "@playwright/test";
import { documents, waitDocuments } from "../helpers/documents";
import { freshStart } from "../helpers/ingest";
import { intake, JD, mcpCall } from "../helpers/postings";
import { login, patchFact } from "../helpers/profiles";

test("F05/E2E-07 recrutador (tools do /mcp, como no terminal): gera, lê, altera e sugere o botão; fato novo deixa desatualizado", async ({
  page,
}) => {
  const { ids } = await freshStart("engineer");
  const p = await intake({ text: JD });
  const gen = await mcpCall<{
    status: string;
    documents: Array<{ documentId: string; url: string }>;
  }>("cv_generate", {
    kind: "cv",
    profileId: ids.profileId,
    postingId: p.id,
    instructions: "foco em backend",
  });
  expect(gen.status).toBe("queued");
  await waitDocuments({ postingId: p.id });
  const got = await mcpCall<{ document: { version: number }; draft: { cv: { summary: string } } }>(
    "cv_get",
    {
      documentId: gen.documents[0]?.documentId,
    },
  );
  await mcpCall("cv_edit", {
    documentId: gen.documents[0]?.documentId,
    baseVersion: got.document.version,
    cv: { ...got.draft.cv, summary: "Resumo alterado pelo recrutador." },
  });
  await expect
    .poll(async () => (await documents({ postingId: p.id }))[0]?.current, { timeout: 60_000 })
    .toMatchObject({ version: 2, status: "ready" });
  const action = await mcpCall<{ url: string }>("ui_suggest_action", {
    action: "document.open",
    label: "Abrir o CV",
    params: { documentId: gen.documents[0]?.documentId },
  });
  await expect(
    mcpCall("ui_suggest_action", {
      action: "document.open",
      label: "x",
      params: { documentId: "outro" },
    }),
  ).rejects.toThrow(/document_not_found/);
  // o link do recrutador abre a vaga com o documento; um fato novo deixa o CV desatualizado
  await patchFact("skill", ids.skillIds[0] as string, { level: 2 });
  await login(page, action.url);
  await expect(page.getByText(/Desatualizado: seus dados mudaram/)).toBeVisible();
});
