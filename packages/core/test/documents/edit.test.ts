import type { CvContent } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import {
  changeDocumentLayout,
  DocumentEditError,
  documentDiff,
  documentText,
  editDocument,
} from "../../src/documents/edit";
import { contentToCvDraft } from "../../src/documents/tools";
import { seedFixture } from "../../src/testing/profile-fixtures";
import { CV_SHORT, LETTER } from "./fixtures/cv";

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const ids = seedFixture(r, "engineer");
  const enqueued: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const enqueue = async (req: { type: string; payload: Record<string, unknown> }) => {
    enqueued.push({ type: req.type, payload: req.payload });
    return {};
  };
  const doc = r.documents.create({
    kind: "cv",
    profileId: ids.profileId,
    postingId: null,
    templateId: "classico",
    paper: "A4",
    locale: "pt-BR",
    format: "pdf",
  });
  const v1 = r.documents.addVersion(doc.id, {
    source: "agent",
    instructions: null,
    factsVersion: 1,
    postingUpdatedAt: null,
    profileHash: "h",
  });
  r.documents.updateVersion(v1.id, { status: "ready", content: CV_SHORT });
  return { r, ids, enqueued, enqueue, doc };
}

/** F05/M6 · edição na tela (e pelo recrutador), troca de modelo e papel sem tokens, e comparação de versões. */
describe("F05/M6 core · edição e versões", () => {
  it("editar cria a versão seguinte e enfileira cv.render com o conteúdo; versão velha dá conflito", async () => {
    const s = setup();
    const draft = contentToCvDraft(CV_SHORT);
    draft.summary = "Resumo editado na tela.";
    const v = await editDocument(s.r, s.enqueue, {
      documentId: s.doc.id,
      baseVersion: 1,
      cv: draft,
      source: "edit",
    });
    expect(v).toMatchObject({ version: 2, source: "edit" });
    expect(s.enqueued[0]).toMatchObject({
      type: "cv.render",
      payload: { versionId: v.id, cv: { summary: "Resumo editado na tela." } },
    });
    s.r.documents.updateVersion(v.id, { status: "ready" });
    await expect(
      editDocument(s.r, s.enqueue, {
        documentId: s.doc.id,
        baseVersion: 1,
        cv: draft,
        source: "edit",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("sem conteúdo do tipo certo, ou com geração em andamento, recusa", async () => {
    const s = setup();
    await expect(
      editDocument(s.r, s.enqueue, {
        documentId: s.doc.id,
        baseVersion: 1,
        letter: { greeting: "x", paragraphs: [] },
        source: "edit",
      }),
    ).rejects.toBeInstanceOf(DocumentEditError);
    s.r.documents.addVersion(s.doc.id, {
      source: "agent",
      instructions: null,
      factsVersion: 1,
      postingUpdatedAt: null,
      profileHash: "h",
    });
    await expect(
      editDocument(s.r, s.enqueue, {
        documentId: s.doc.id,
        baseVersion: 2,
        cv: contentToCvDraft(CV_SHORT),
        source: "edit",
      }),
    ).rejects.toMatchObject({ code: "busy" });
  });

  it("trocar modelo ou papel: documento atualizado e re-render do conteúdo atual, sem o gerador", async () => {
    const s = setup();
    const v = await changeDocumentLayout(s.r, s.enqueue, {
      documentId: s.doc.id,
      templateId: "moderno",
      paper: "Letter",
    });
    expect(s.r.documents.get(s.doc.id)).toMatchObject({ templateId: "moderno", paper: "Letter" });
    expect(v).toMatchObject({
      version: 2,
      source: "template",
      templateId: "moderno",
      paper: "Letter",
    });
    expect(s.enqueued[0]).toMatchObject({
      type: "cv.render",
      payload: { cv: { summary: CV_SHORT.summary } },
    });
    s.r.documents.updateVersion(v.id, { status: "ready", content: CV_SHORT });
    await expect(
      changeDocumentLayout(s.r, s.enqueue, { documentId: s.doc.id, templateId: "nao-existe" }),
    ).rejects.toMatchObject({ code: "template_not_found" });
  });

  it("voltar a um modelo já montado com o mesmo conteúdo reaproveita a versão, sem montar de novo", async () => {
    const s = setup();
    const v2 = await changeDocumentLayout(s.r, s.enqueue, {
      documentId: s.doc.id,
      templateId: "moderno",
    });
    s.r.documents.updateVersion(v2.id, { status: "ready", content: CV_SHORT });
    const back = await changeDocumentLayout(s.r, s.enqueue, {
      documentId: s.doc.id,
      templateId: "classico",
    });
    expect(back).toMatchObject({ version: 1, templateId: "classico" });
    expect(s.r.documents.get(s.doc.id)).toMatchObject({
      templateId: "classico",
      currentVersion: 1,
    });
    expect(s.enqueued).toHaveLength(1);
    // de novo para o Moderno: a v2 volta a ser a atual
    const again = await changeDocumentLayout(s.r, s.enqueue, {
      documentId: s.doc.id,
      templateId: "moderno",
    });
    expect(again).toMatchObject({ version: 2 });
    expect(s.r.documents.get(s.doc.id)?.currentVersion).toBe(2);
    expect(s.enqueued).toHaveLength(1);
    expect(s.r.documents.listVersions(s.doc.id)).toHaveLength(2);
    // com a v1 atual de novo, a próxima versão continua numerada depois da maior (v3)
    await changeDocumentLayout(s.r, s.enqueue, { documentId: s.doc.id, templateId: "classico" });
    const v3 = await changeDocumentLayout(s.r, s.enqueue, {
      documentId: s.doc.id,
      templateId: "compacto",
    });
    expect(v3.version).toBe(3);
  });

  it("conteúdo diferente (editado depois) ou versão com erro: monta de novo", async () => {
    const s = setup();
    const v2 = await changeDocumentLayout(s.r, s.enqueue, {
      documentId: s.doc.id,
      templateId: "moderno",
    });
    s.r.documents.updateVersion(v2.id, {
      status: "ready",
      content: { ...CV_SHORT, summary: "Resumo editado no Moderno." },
    });
    const back = await changeDocumentLayout(s.r, s.enqueue, {
      documentId: s.doc.id,
      templateId: "classico",
    });
    expect(back.version).toBe(3);
    expect(s.enqueued).toHaveLength(2);
  });

  it("versão do modelo que deu erro não é reaproveitada", async () => {
    const s = setup();
    const v2 = await changeDocumentLayout(s.r, s.enqueue, {
      documentId: s.doc.id,
      templateId: "moderno",
    });
    s.r.documents.updateVersion(v2.id, { status: "error", content: CV_SHORT });
    const back = await changeDocumentLayout(s.r, s.enqueue, {
      documentId: s.doc.id,
      templateId: "classico",
    });
    expect(back.version).toBe(1);
    const again = await changeDocumentLayout(s.r, s.enqueue, {
      documentId: s.doc.id,
      templateId: "moderno",
    });
    expect(again.version).toBe(3);
    expect(s.enqueued).toHaveLength(2);
  });

  it("texto do documento e diff por linha entre versões", () => {
    const a = documentText(CV_SHORT);
    expect(a).toContain("Reduziu a latência p95 do checkout de 800 ms para 300 ms.");
    const changed: CvContent = { ...CV_SHORT, summary: "Resumo novo." };
    const diff = documentDiff(CV_SHORT, changed);
    expect(diff).toContainEqual({ op: "-", text: CV_SHORT.summary });
    expect(diff).toContainEqual({ op: "+", text: "Resumo novo." });
    expect(diff.filter((d) => d.op === "=").length).toBeGreaterThan(3);
    expect(documentText(LETTER)).toContain("Olá, time da Acme");
  });
});
