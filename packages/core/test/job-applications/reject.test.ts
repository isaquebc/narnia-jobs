import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import {
  applyToPosting,
  JobApplicationError,
  jobApplicationFunnel,
  rejectJobApplication,
} from "../../src/job-applications";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * Desclassificação (pedido do dono, 2026-10-29): a pessoa recebe o e-mail "o processo foi finalizado" ou "você não
 * seguiu na etapa X" e cola o texto. A candidatura vai para Encerrado com o motivo `rejected`, a etapa em que parou
 * fica registrada (o funil conta por etapa) e o texto vira uma nota datada (decisão do dono: nota, não campo próprio).
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "narnia-entries-"));
  dirs.push(dataDir);
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const { profileId } = seedFixture(r, "engineer");
  const p = r.postings.create({ company: "Acme", title: "Backend" }, { source: "user" });
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
  const app = applyToPosting(r, { postingId: p.id, cvVersionId: v.id, appliedOn: "2026-10-20" });
  return { r, app, dataDir };
}

const now = new Date("2026-10-29T12:00:00.000Z");
const EMAIL =
  "Olá! Esse e-mail é para informar que o processo seletivo para a vaga de Backend foi finalizado.";

describe("desclassificação", () => {
  it("encerra como reprovada na etapa escolhida e guarda o e-mail como nota datada", () => {
    const { r, app, dataDir } = setup();
    const stage = app.stages[1];
    const done = rejectJobApplication(
      r,
      dataDir,
      app.id,
      { occurredOn: "2026-10-28", message: `  ${EMAIL}  `, stageId: stage?.id ?? null },
      now,
    );
    expect(done).toMatchObject({
      column: "closed",
      closedReason: "rejected",
      closedStage: stage?.name,
    });
    const notes = r.jobApplicationEntries.list(app.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ occurredOn: "2026-10-28", body: EMAIL });
    expect(done.closedEntryId).toBe(notes[0]?.id);
  });

  it("sem etapa (processo finalizado sem dizer onde): fica sem etapa", () => {
    const { r, app, dataDir } = setup();
    const done = rejectJobApplication(
      r,
      dataDir,
      app.id,
      { occurredOn: "2026-10-29", message: EMAIL, stageId: null },
      now,
    );
    expect(done).toMatchObject({ column: "closed", closedReason: "rejected", closedStage: null });
  });

  it("recusa texto vazio, etapa de fora, data futura e candidatura já encerrada", () => {
    const { r, app, dataDir } = setup();
    const run =
      (o: Partial<{ occurredOn: string; message: string; stageId: string | null }>) => () =>
        rejectJobApplication(
          r,
          dataDir,
          app.id,
          { occurredOn: "2026-10-29", message: EMAIL, stageId: null, ...o },
          now,
        );
    expect(run({ message: "   " })).toThrow(JobApplicationError);
    expect(run({ stageId: "outra" })).toThrow(/Etapa/);
    expect(run({ occurredOn: "2026-10-31" })).toThrow(JobApplicationError);
    // nada mudou com os erros
    expect(r.jobApplications.get(app.id)?.column).toBe("applied");
    expect(r.jobApplicationEntries.list(app.id)).toHaveLength(0);
    run({})();
    expect(run({})).toThrow(/encerrada/);
  });

  it("sair de Encerrado limpa a etapa e a ligação com a nota (a nota fica)", () => {
    const { r, app, dataDir } = setup();
    rejectJobApplication(
      r,
      dataDir,
      app.id,
      { occurredOn: "2026-10-29", message: EMAIL, stageId: app.stages[0]?.id ?? null },
      now,
    );
    const back = r.jobApplications.update(app.id, { column: "in_process" }, now);
    expect(back).toMatchObject({ closedReason: null, closedStage: null, closedEntryId: null });
    expect(r.jobApplicationEntries.list(app.id)).toHaveLength(1);
  });

  it("o funil conta as desclassificações por etapa", () => {
    const { r, app, dataDir } = setup();
    rejectJobApplication(
      r,
      dataDir,
      app.id,
      { occurredOn: "2026-10-29", message: EMAIL, stageId: app.stages[0]?.id ?? null },
      now,
    );
    expect(jobApplicationFunnel(r).rejectedByStage).toEqual({ [app.stages[0]?.name as string]: 1 });
  });
});
