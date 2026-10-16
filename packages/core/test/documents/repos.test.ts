import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { seedFixture } from "../../src/testing/profile-fixtures";

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const ids = seedFixture(r, "engineer");
  return { r, ids };
}

const base = { templateId: "classico", paper: "A4", locale: "pt-BR", format: "pdf" } as const;
const versionInput = {
  source: "agent",
  instructions: null,
  factsVersion: 3,
  postingUpdatedAt: null,
  profileHash: "h1",
} as const;

/** F05/M1 · documentos (CV e carta), versões e templates do usuário (migração 0015). */
describe("F05/M1 core · repositório de documentos", () => {
  it("um CV por perfil sem vaga e um por perfil e vaga; carta separada do CV", () => {
    const { r, ids } = setup();
    const posting = r.postings.create({ company: "Acme" }, { source: "user" });
    const cv = r.documents.create({
      kind: "cv",
      profileId: ids.profileId,
      postingId: null,
      ...base,
    });
    expect(() =>
      r.documents.create({ kind: "cv", profileId: ids.profileId, postingId: null, ...base }),
    ).toThrow();
    const cvVaga = r.documents.create({
      kind: "cv",
      profileId: ids.profileId,
      postingId: posting.id,
      ...base,
    });
    const carta = r.documents.create({
      kind: "cover_letter",
      profileId: ids.profileId,
      postingId: posting.id,
      ...base,
      format: "text",
    });
    expect(r.documents.find("cv", ids.profileId, null)?.id).toBe(cv.id);
    expect(r.documents.find("cv", ids.profileId, posting.id)?.id).toBe(cvVaga.id);
    expect(
      r.documents
        .list({ postingId: posting.id })
        .map((d) => d.id)
        .sort(),
    ).toEqual([cvVaga.id, carta.id].sort());
    expect(r.documents.list({ profileId: ids.profileId })).toHaveLength(3);
    expect(cv).toMatchObject({ currentVersion: 0, templateId: "classico", format: "pdf" });
  });

  it("versões numeradas em sequência; a atual acompanha; update parcial", () => {
    const { r, ids } = setup();
    const d = r.documents.create({
      kind: "cv",
      profileId: ids.profileId,
      postingId: null,
      ...base,
    });
    const v1 = r.documents.addVersion(d.id, versionInput);
    const v2 = r.documents.addVersion(d.id, { ...versionInput, source: "edit" });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(v1).toMatchObject({
      status: "queued",
      attempts: 0,
      templateId: "classico",
      locale: "pt-BR",
      content: null,
      review: null,
    });
    expect(r.documents.get(d.id)?.currentVersion).toBe(2);
    const u = r.documents.updateVersion(v1.id, {
      status: "ready_with_issues",
      attempts: 2,
      review: { passed: false, atsScore: 81, issues: [] },
      atsScore: 81,
      pagesRendered: 2,
      pdfPath: "documents/x/v1/cv.pdf",
    });
    expect(u).toMatchObject({
      status: "ready_with_issues",
      attempts: 2,
      atsScore: 81,
      pagesRendered: 2,
    });
    expect(r.documents.listVersions(d.id).map((v) => v.version)).toEqual([2, 1]);
    expect(r.documents.getVersion(d.id, 1)?.id).toBe(v1.id);
    expect(r.documents.currentVersion(d.id)?.id).toBe(v2.id);
  });

  it("status desconhecido é recusado pelo banco", () => {
    const { r, ids } = setup();
    const d = r.documents.create({
      kind: "cv",
      profileId: ids.profileId,
      postingId: null,
      ...base,
    });
    const v = r.documents.addVersion(d.id, versionInput);
    expect(() => r.documents.updateVersion(v.id, { status: "pronto" as never })).toThrow();
  });

  it("apagar a vaga apaga os documentos dela; apagar o perfil apaga os do perfil", () => {
    const { r, ids } = setup();
    const posting = r.postings.create({ company: "Acme" }, { source: "user" });
    r.documents.create({ kind: "cv", profileId: ids.profileId, postingId: posting.id, ...base });
    const d = r.documents.create({
      kind: "cv",
      profileId: ids.profileId,
      postingId: null,
      ...base,
    });
    r.documents.addVersion(d.id, versionInput);
    r.postings.remove(posting.id);
    expect(r.documents.list({ profileId: ids.profileId }).map((x) => x.id)).toEqual([d.id]);
    r.documents.remove(d.id);
    expect(r.documents.get(d.id)).toBeNull();
    expect(r.documents.listVersions(d.id)).toEqual([]);
  });

  it("templates do usuário: cria em validação, marca válido ou inválido com os erros, lista e apaga", () => {
    const { r } = setup();
    const t = r.cvTemplates.create({
      name: "Meu template",
      engine: "handlebars",
      path: "templates/t1",
      manifest: { name: "Meu" },
    });
    expect(t).toMatchObject({ status: "validating", validationErrors: [] });
    r.cvTemplates.update(t.id, {
      status: "invalid",
      validationErrors: ["<script> não é permitido"],
    });
    expect(r.cvTemplates.get(t.id)).toMatchObject({
      status: "invalid",
      validationErrors: ["<script> não é permitido"],
    });
    expect(r.cvTemplates.list()).toHaveLength(1);
    r.cvTemplates.remove(t.id);
    expect(r.cvTemplates.list()).toEqual([]);
  });
});
