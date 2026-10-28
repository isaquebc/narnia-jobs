import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import {
  applyToPosting,
  DEFAULT_STAGES,
  JobApplicationError,
  setCurrentStage,
  setJobApplicationStages,
} from "../../src/job-applications";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * F07/M2: o pipeline de cada candidatura é ajustável (adicionar, remover, reordenar) e a etapa atual é escolhida pela
 * pessoa; as etapas lidas da descrição da vaga (`hiringSteps`) viram o pipeline ao aplicar.
 */
function setup(hiringSteps: string[] = []) {
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const { profileId } = seedFixture(r, "engineer");
  const p = r.postings.create(
    { company: "Acme", title: "Backend", hiringSteps },
    { source: "model" },
  );
  const d = r.documents.create({
    kind: "cv",
    profileId,
    postingId: p.id,
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
  const app = applyToPosting(r, { postingId: p.id, cvVersionId: v.id, appliedOn: "2026-10-27" });
  return { r, app, posting: p };
}

describe("F07/M2 · pipeline da candidatura", () => {
  it("sem etapas na vaga, o padrão; com etapas lidas da vaga, elas", () => {
    expect(setup().app.stages.map((s) => s.name)).toEqual([...DEFAULT_STAGES]);
    const { app } = setup(["Triagem", "Case técnico", "Conversa com o CTO"]);
    expect(app.stages.map((s) => [s.name, s.position])).toEqual([
      ["Triagem", 1],
      ["Case técnico", 2],
      ["Conversa com o CTO", 3],
    ]);
    expect(app.currentStageId).toBe(app.stages[0]?.id);
  });

  it("adiciona, remove e reordena mantendo os ids das que ficam e a etapa atual", () => {
    const { r, app } = setup();
    const [a, b, c] = app.stages;
    const cur = setCurrentStage(r, app.id, c?.id ?? null);
    expect(cur.currentStageId).toBe(c?.id);
    const out = setJobApplicationStages(r, app.id, [
      { id: c?.id, name: c?.name ?? "" },
      { name: "Pair programming" },
      { id: a?.id, name: "Análise do CV" },
    ]);
    expect(out.stages.map((s) => [s.name, s.position])).toEqual([
      [c?.name, 1],
      ["Pair programming", 2],
      ["Análise do CV", 3],
    ]);
    expect(out.stages[0]?.id).toBe(c?.id);
    expect(out.stages[2]?.id).toBe(a?.id);
    expect(out.stages.some((s) => s.id === b?.id)).toBe(false);
    expect(out.currentStageId).toBe(c?.id);
    expect(r.jobApplications.get(app.id)?.lastActivityAt).toBeTruthy();
  });

  it("remover a etapa atual passa para a que ficou na mesma posição (ou a última); sem etapas, nenhuma", () => {
    const { r, app } = setup();
    const [a, b, c] = app.stages;
    setCurrentStage(r, app.id, b?.id ?? null);
    const out = setJobApplicationStages(r, app.id, [
      { id: a?.id, name: a?.name ?? "" },
      { id: c?.id, name: c?.name ?? "" },
    ]);
    expect(out.currentStageId).toBe(c?.id);
    expect(setJobApplicationStages(r, app.id, []).currentStageId).toBeNull();
  });

  it("etapa de outra candidatura ou id desconhecido é recusado", () => {
    const { r, app } = setup();
    expect(() => setCurrentStage(r, app.id, "nao-existe")).toThrow(JobApplicationError);
    expect(() => setJobApplicationStages(r, app.id, [{ id: "nao-existe", name: "X" }])).toThrow(
      JobApplicationError,
    );
  });

  it("0029 entra sobre o banco anterior e a vaga antiga fica sem etapas", () => {
    const db = openDatabase(":memory:");
    migrate(db, { until: "0028_posting_archive" });
    const r0 = createRepos(db);
    expect(migrate(db).applied[0]).toBe("0029_posting_hiring_steps");
    expect(r0.postings.create({ company: "X" }, { source: "user" }).hiringSteps).toEqual([]);
  });

  it("mudar a etapa desarquiva (é atividade)", () => {
    const { r, app } = setup();
    r.jobApplications.update(app.id, { archived: true });
    expect(setCurrentStage(r, app.id, app.stages[1]?.id ?? null).archivedAt).toBeNull();
  });
});
