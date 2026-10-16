import type { CvContent } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { createCvTools } from "../../src/documents/tools";
import { seedFixture } from "../../src/testing/profile-fixtures";
import { CV_SHORT } from "./fixtures/cv";

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const ids = seedFixture(r, "engineer");
  const enqueued: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const changed: string[] = [];
  const tools = createCvTools(r, {
    ports: {
      enqueue: async (req) => {
        enqueued.push({ type: req.type, payload: req.payload });
        return { job: { id: "j" } };
      },
      changed: (d) => changed.push(d.id),
    },
  });
  return { r, ids, tools, enqueued, changed };
}

const JD_EN = `Senior Backend Engineer at Initech. Requirements: Node.js, TypeScript and Kubernetes in production for the payments team with the engineers of the platform.`;

/** F05/M4 · tools do recrutador: gerar (com confirmação de idioma), ler, alterar sem regerar, listar e sugerir botão. */
describe("F05/M4 core · tools do CV", () => {
  it("cv.generate: mesmo caminho do botão; idioma não coberto volta como pergunta, não como erro", async () => {
    const s = setup();
    for (const l of s.r.facts.languages.list()) s.r.facts.languages.remove(l.id);
    const p = s.r.postings.create({ company: "Initech", jdText: JD_EN }, { source: "user" });
    const ask = await s.tools["cv.generate"]({
      kind: "cv",
      profileId: s.ids.profileId,
      postingId: p.id,
    });
    expect(ask).toMatchObject({
      status: "needs_language_confirmation",
      language: "Inglês",
      documents: [],
    });
    const ok = await s.tools["cv.generate"]({
      kind: "cv",
      profileId: s.ids.profileId,
      postingId: p.id,
      acceptLanguage: true,
      withCoverLetter: true,
    });
    expect(ok.status).toBe("queued");
    expect(ok.documents.map((d) => d.kind)).toEqual(["cv", "cover_letter"]);
    expect(ok.documents[0]?.url).toBe(`/vagas/${p.id}?doc=${ok.documents[0]?.documentId}`);
    expect(s.r.documents.currentVersion(ok.documents[0]?.documentId as string)?.source).toBe(
      "recruiter",
    );
    expect(s.changed).toHaveLength(2);
  });

  it("cv.get devolve o conteúdo no formato de edição; cv.edit cria versão nova e enfileira cv.render com o conteúdo", async () => {
    const s = setup();
    const gen = await s.tools["cv.generate"]({ kind: "cv", profileId: s.ids.profileId });
    const docId = gen.documents[0]?.documentId as string;
    const v1 = s.r.documents.currentVersion(docId) as NonNullable<
      ReturnType<typeof s.r.documents.currentVersion>
    >;
    s.r.documents.updateVersion(v1.id, {
      status: "ready",
      content: { ...CV_SHORT, meta: { ...CV_SHORT.meta, profileId: s.ids.profileId } } as CvContent,
    });
    const got = await s.tools["cv.get"]({ documentId: docId });
    expect(got.document?.version).toBe(1);
    expect(got.draft?.cv?.headline).toBe(CV_SHORT.header.title);
    const draft = got.draft?.cv as NonNullable<NonNullable<typeof got.draft>["cv"]>;
    draft.summary = "Resumo alterado pelo recrutador.";
    const edited = await s.tools["cv.edit"]({ documentId: docId, baseVersion: 1, cv: draft });
    expect(edited).toMatchObject({ version: 2, status: "queued" });
    expect(s.enqueued.at(-1)).toMatchObject({
      type: "cv.render",
      payload: { documentId: docId, cv: { summary: "Resumo alterado pelo recrutador." } },
    });
    // versão desatualizada: conflito, nada enfileirado
    s.r.documents.updateVersion(s.r.documents.currentVersion(docId)?.id as string, {
      status: "ready",
    });
    await expect(
      s.tools["cv.edit"]({ documentId: docId, baseVersion: 1, cv: draft }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("ui.suggest_action: ação com ids que existem vira link; id inventado ou carta sem vaga é recusado", async () => {
    const s = setup();
    const p = s.r.postings.create({ company: "Initech" }, { source: "user" });
    const ok = await s.tools["ui.suggest_action"]({
      action: "document.generate",
      label: "Gerar CV para esta vaga",
      params: { kind: "cv", profileId: s.ids.profileId, postingId: p.id },
    });
    expect(ok.url).toBe(`/vagas/${p.id}?gerar=cv&perfil=${s.ids.profileId}`);
    await expect(
      s.tools["ui.suggest_action"]({
        action: "document.generate",
        label: "x",
        params: { kind: "cv", profileId: "outro-usuario" },
      }),
    ).rejects.toMatchObject({ code: "invalid_action" });
    await expect(
      s.tools["ui.suggest_action"]({
        action: "document.generate",
        label: "x",
        params: { kind: "cover_letter", profileId: s.ids.profileId },
      }),
    ).rejects.toMatchObject({ code: "invalid_action" });
    await expect(
      s.tools["ui.suggest_action"]({
        action: "document.open",
        label: "x",
        params: { documentId: "nao" },
      }),
    ).rejects.toMatchObject({ code: "document_not_found" });
  });

  it("cv.list por perfil e por vaga", async () => {
    const s = setup();
    await s.tools["cv.generate"]({ kind: "cv", profileId: s.ids.profileId });
    expect((await s.tools["cv.list"]({ profileId: s.ids.profileId })).documents).toHaveLength(1);
    expect((await s.tools["cv.list"]({ postingId: "nenhuma" })).documents).toEqual([]);
  });
});
