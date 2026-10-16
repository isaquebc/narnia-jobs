import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import {
  DocumentRequestError,
  documentStale,
  documentView,
  requestDocument,
} from "../../src/documents/request";
import { seedFixture } from "../../src/testing/profile-fixtures";

const JD_EN = `Senior Backend Engineer at Initech. Requirements: Node.js, TypeScript and Kubernetes in production for the payments team with the engineers of the platform.`;

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const ids = seedFixture(r, "engineer");
  const enqueued: Array<{ type: string; key: string; payload: Record<string, unknown> }> = [];
  const enqueue = async (req: {
    queue: string;
    type: string;
    key: string;
    payload?: Record<string, unknown>;
  }) => {
    enqueued.push({ type: req.type, key: req.key, payload: req.payload ?? {} });
    return { job: { id: `task__${req.type}__${req.key}` } };
  };
  return { r, ids, enqueued, enqueue };
}

/** F05/M4 · pedido de CV ou carta (rota e recrutador): idioma, cobertura do idioma, documento por perfil e vaga. */
describe("F05/M4 core · pedido de documento", () => {
  it("CV do perfil: cria o documento (A4, Clássico, idioma do perfil), a versão e enfileira cv.generate", async () => {
    const s = setup();
    const res = await requestDocument(s.r, s.enqueue, {
      kind: "cv",
      profileId: s.ids.profileId,
      postingId: null,
      instructions: "foco em liderança",
    });
    expect(res.created).toBe(true);
    expect(res.document).toMatchObject({
      kind: "cv",
      locale: "pt-BR",
      paper: "A4",
      templateId: "classico",
      currentVersion: 1,
    });
    expect(res.version).toMatchObject({
      status: "queued",
      source: "agent",
      instructions: "foco em liderança",
    });
    expect(s.enqueued).toEqual([
      {
        type: "cv.generate",
        key: res.document.id,
        payload: { documentId: res.document.id, versionId: res.version.id },
      },
    ]);
    // "Atualizar": mesmo documento, versão 2
    s.r.documents.updateVersion(res.version.id, { status: "ready" });
    const again = await requestDocument(s.r, s.enqueue, {
      kind: "cv",
      profileId: s.ids.profileId,
      postingId: null,
    });
    expect(again.document.id).toBe(res.document.id);
    expect(again.version.version).toBe(2);
  });

  it("'Tentar de novo' (fixIssues): leva os erros da revisão da versão atual para o gerador", async () => {
    const s = setup();
    const a = await requestDocument(s.r, s.enqueue, {
      kind: "cv",
      profileId: s.ids.profileId,
      postingId: null,
    });
    s.r.documents.updateVersion(a.version.id, {
      status: "ready_with_issues",
      review: {
        passed: false,
        atsScore: 80,
        issues: [
          { area: "ats", severity: "error", message: "ATS de 80%.", where: null },
          { area: "layout", severity: "warning", message: "Página 2 curta.", where: "p. 2" },
        ],
      },
    });
    const b = await requestDocument(s.r, s.enqueue, {
      kind: "cv",
      profileId: s.ids.profileId,
      postingId: null,
      fixIssues: true,
    });
    expect(s.enqueued[1]?.payload).toEqual({
      documentId: b.document.id,
      versionId: b.version.id,
      previousIssues: [{ area: "ats", message: "ATS de 80%.", where: null }],
    });
    // sem fixIssues, o "Atualizar" começa do zero
    s.r.documents.updateVersion(b.version.id, { status: "ready" });
    await requestDocument(s.r, s.enqueue, {
      kind: "cv",
      profileId: s.ids.profileId,
      postingId: null,
    });
    expect(s.enqueued[2]?.payload).not.toHaveProperty("previousIssues");
  });

  it("pedido com uma geração em andamento devolve a mesma versão (sem enfileirar de novo)", async () => {
    const s = setup();
    const a = await requestDocument(s.r, s.enqueue, {
      kind: "cv",
      profileId: s.ids.profileId,
      postingId: null,
    });
    const b = await requestDocument(s.r, s.enqueue, {
      kind: "cv",
      profileId: s.ids.profileId,
      postingId: null,
    });
    expect(b.version.id).toBe(a.version.id);
    expect(s.enqueued).toHaveLength(1);
  });

  it("vaga em inglês sem inglês nos dados: pede confirmação; com acceptLanguage, gera em en-US", async () => {
    const s = setup();
    for (const l of s.r.facts.languages.list()) s.r.facts.languages.remove(l.id);
    const p = s.r.postings.create({ company: "Initech", jdText: JD_EN }, { source: "user" });
    await expect(
      requestDocument(s.r, s.enqueue, { kind: "cv", profileId: s.ids.profileId, postingId: p.id }),
    ).rejects.toMatchObject({
      code: "language_not_covered",
      language: "Inglês",
    });
    expect(s.enqueued).toEqual([]);
    const ok = await requestDocument(s.r, s.enqueue, {
      kind: "cv",
      profileId: s.ids.profileId,
      postingId: p.id,
      acceptLanguage: true,
    });
    expect(ok.document).toMatchObject({ locale: "en-US", postingId: p.id });
  });

  it("carta exige vaga; perfil ou vaga inexistentes dão erro tipado", async () => {
    const s = setup();
    await expect(
      requestDocument(s.r, s.enqueue, {
        kind: "cover_letter",
        profileId: s.ids.profileId,
        postingId: null,
      }),
    ).rejects.toBeInstanceOf(DocumentRequestError);
    await expect(
      requestDocument(s.r, s.enqueue, { kind: "cv", profileId: "x", postingId: null }),
    ).rejects.toMatchObject({ code: "profile_not_found" });
    await expect(
      requestDocument(s.r, s.enqueue, { kind: "cv", profileId: s.ids.profileId, postingId: "x" }),
    ).rejects.toMatchObject({ code: "posting_not_found" });
  });

  it("validade: fatos, perfil (ênfase) e vaga posteriores à versão marcam 'desatualizado'", async () => {
    const s = setup();
    const p = s.r.postings.create({ company: "Initech", jdText: JD_EN }, { source: "user" });
    const res = await requestDocument(s.r, s.enqueue, {
      kind: "cv",
      profileId: s.ids.profileId,
      postingId: p.id,
      acceptLanguage: true,
    });
    expect(documentStale(s.r, res.document, res.version)).toEqual({
      facts: false,
      profile: false,
      posting: false,
    });
    s.r.facts.skills.insert({
      name: "Elixir",
      category: "language",
      confidence: 1,
      verified: true,
    });
    s.r.emphasis.replace(s.ids.profileId, [
      { kind: "skill", id: s.ids.skillIds[0] as string, mode: "highlight" },
    ]);
    s.r.postings.update(p.id, { jdText: `${JD_EN} Also Go.` });
    expect(documentStale(s.r, res.document, res.version)).toEqual({
      facts: true,
      profile: true,
      posting: true,
    });
  });

  it("visão do documento: versão atual, lista de versões, validade e links que faltam", async () => {
    const s = setup();
    const res = await requestDocument(s.r, s.enqueue, {
      kind: "cv",
      profileId: s.ids.profileId,
      postingId: null,
    });
    const v = documentView(s.r, res.document);
    expect(v.current?.id).toBe(res.version.id);
    expect(v.versions.map((x) => x.version)).toEqual([1]);
    expect(v.missingLinks).toEqual(["linkedin", "github", "portfolio"]);
  });
});
