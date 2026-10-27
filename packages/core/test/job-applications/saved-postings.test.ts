import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import {
  applyToPosting,
  listSavedPostings,
  postingApplicationRef,
} from "../../src/job-applications";
import { searchPostings } from "../../src/postings/search";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * F07 (pedido do dono 2026-10-27): a vaga salva sem candidatura é a coluna "Vagas salvas" do quadro; a lista de vagas
 * destaca as já aplicadas; arquivar a vaga ("não deu um bom fit") guarda o motivo e a tira das vagas salvas.
 */
function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const { profileId } = seedFixture(r, "engineer");
  const posting = (company: string, title: string) =>
    r.postings.create({ company, title }, { source: "user" });
  const apply = (postingId: string) => {
    const d = r.documents.create({
      kind: "cv",
      profileId,
      postingId,
      templateId: "classico",
      paper: "A4",
      locale: "pt-BR",
      format: "pdf",
    });
    const v = r.documents.addVersion(d.id, {
      source: "agent",
      instructions: null,
      factsVersion: 1,
      postingUpdatedAt: null,
      profileHash: "h",
    });
    r.documents.updateVersion(v.id, { status: "ready" });
    return applyToPosting(r, { postingId, cvVersionId: v.id, appliedOn: "2026-10-27" });
  };
  return { db, r, posting, apply };
}

describe("F07 · arquivar a vaga com o motivo", () => {
  it("guarda o motivo e a nota; desarquivar limpa os três", () => {
    const { r, posting } = setup();
    const p = posting("Acme", "Backend");
    const now = new Date("2026-10-27T12:00:00.000Z");
    r.postings.setArchived(p.id, { reason: "salary", note: "Abaixo do meu piso" }, now);
    expect(r.postings.get(p.id)).toMatchObject({
      archivedAt: now.toISOString(),
      archiveReason: "salary",
      archiveNote: "Abaixo do meu piso",
    });
    r.postings.setArchived(p.id, null);
    expect(r.postings.get(p.id)).toMatchObject({
      archivedAt: null,
      archiveReason: null,
      archiveNote: null,
    });
  });

  it("a busca da lista de vagas separa as arquivadas; sem o filtro (recrutador), vê todas", () => {
    const { r, posting } = setup();
    const a = posting("Acme", "Backend");
    const b = posting("Beta", "Backend");
    r.postings.setArchived(b.id, { reason: "stack", note: null });
    expect(searchPostings(r, "backend", { archived: false }).map((p) => p.id)).toEqual([a.id]);
    expect(searchPostings(r, "backend", { archived: true }).map((p) => p.id)).toEqual([b.id]);
    expect(searchPostings(r, "backend")).toHaveLength(2);
  });
});

describe("F07 · vagas salvas e o destaque das aplicadas", () => {
  it("vagas salvas: sem candidatura e não arquivadas (ou só as arquivadas); com busca", () => {
    const { r, posting, apply } = setup();
    const saved = posting("Acme", "Backend");
    const applied = posting("Beta", "Frontend");
    const archived = posting("Gama", "Dados");
    apply(applied.id);
    r.postings.setArchived(archived.id, { reason: "company", note: null });
    expect(listSavedPostings(r, {}).map((p) => p.id)).toEqual([saved.id]);
    expect(listSavedPostings(r, { archived: true }).map((p) => [p.id, p.archiveReason])).toEqual([
      [archived.id, "company"],
    ]);
    expect(listSavedPostings(r, { q: "acme" })).toHaveLength(1);
    expect(listSavedPostings(r, { q: "beta" })).toHaveLength(0);
  });

  it("a candidatura da vaga (a mais recente) para o destaque; sem candidatura, null", () => {
    const { r, posting, apply } = setup();
    const p = posting("Acme", "Backend");
    expect(postingApplicationRef(r, p.id)).toBeNull();
    const a = apply(p.id);
    r.jobApplications.update(a.id, { column: "in_process" });
    expect(postingApplicationRef(r, p.id)).toEqual({
      id: a.id,
      column: "in_process",
      archived: false,
    });
  });

  it("0028 entra sobre o banco anterior", () => {
    const db = openDatabase(":memory:");
    migrate(db, { until: "0027_job_application" });
    expect(migrate(db).applied).toEqual(["0028_posting_archive"]);
  });
});
