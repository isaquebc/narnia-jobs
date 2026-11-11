import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import { withTransaction } from "../../src/db/open";
import {
  applyToPosting,
  JobApplicationError,
  setJobApplicationProfileAndCv,
} from "../../src/job-applications";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * F14/M5 · candidaturas: RT-C1 (as linhas de passagem de coluna, conferidas direto) e RT-C2 (o Aplicar continua
 * exigindo o CV) antes das mudanças; depois, a candidatura vinda de e-mail (sem CV, com o instante do e-mail, sem
 * mexer na atividade) da F14-15.
 */
const base = { templateId: "classico", paper: "A4", locale: "pt-BR", format: "pdf" } as const;
const versionInput = {
  source: "agent",
  instructions: null,
  factsVersion: 1,
  postingUpdatedAt: null,
  profileHash: "h1",
} as const;

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const { profileId } = seedFixture(r, "engineer");
  const posting = r.postings.create({ company: "Acme", title: "Backend Sr" }, { source: "user" });
  const d = r.documents.create({ kind: "cv", profileId, postingId: posting.id, ...base });
  const v = r.documents.addVersion(d.id, versionInput);
  r.documents.updateVersion(v.id, { status: "ready" });
  const moves = (id: string) =>
    db
      .prepare(
        "select from_column, to_column, at from job_application_move where job_application_id = ? order by at, rowid",
      )
      .all(id) as Array<{ from_column: string | null; to_column: string; at: string }>;
  return { db, r, profileId, posting, cvVersionId: v.id, moves };
}

describe("F14/M5 · RT-C1 · passagens de coluna", () => {
  it("criar, mover, encerrar e reabrir gravam uma linha cada, com o instante", () => {
    const { r, posting, cvVersionId, moves } = setup();
    const t0 = new Date("2026-11-01T10:00:00.000Z");
    const a = applyToPosting(
      r,
      { postingId: posting.id, cvVersionId, appliedOn: "2026-11-01" },
      t0,
    );
    r.jobApplications.update(
      a.id,
      { column: "first_interview" },
      new Date("2026-11-03T10:00:00.000Z"),
    );
    r.jobApplications.update(
      a.id,
      { column: "closed", closedReason: "rejected" },
      new Date("2026-11-05T10:00:00.000Z"),
    );
    r.jobApplications.update(a.id, { column: "in_process" }, new Date("2026-11-06T10:00:00.000Z"));
    expect(moves(a.id)).toEqual([
      { from_column: null, to_column: "applied", at: "2026-11-01T10:00:00.000Z" },
      { from_column: "applied", to_column: "first_interview", at: "2026-11-03T10:00:00.000Z" },
      { from_column: "first_interview", to_column: "closed", at: "2026-11-05T10:00:00.000Z" },
      { from_column: "closed", to_column: "in_process", at: "2026-11-06T10:00:00.000Z" },
    ]);
  });
});

describe("F14/M5 · RT-C2 · o Aplicar continua exigindo o CV", () => {
  it("sem CV: cv_required", () => {
    const { r, posting } = setup();
    expect(() =>
      applyToPosting(r, {
        postingId: posting.id,
        cvVersionId: "",
        appliedOn: "2026-11-01",
      } as never),
    ).toThrow(JobApplicationError);
  });
});

describe("F14/M5 · transação aninhada (revisão do M5, #11)", () => {
  it("erro capturado na de dentro desfaz só ela; a de fora segue e grava o resto", () => {
    const db = openDatabase(":memory:");
    db.exec("create table t (v text)");
    withTransaction(db, () => {
      db.prepare("insert into t values ('fora')").run();
      try {
        withTransaction(db, () => {
          db.prepare("insert into t values ('dentro')").run();
          throw new Error("falhou");
        });
      } catch {
        // quem chama decidiu seguir
      }
    });
    expect(db.prepare("select v from t").all()).toEqual([{ v: "fora" }]);
  });
});

describe("F14/M7 · perfil e CV da candidatura vinda de e-mail (revisão do M5, #8)", () => {
  it("troca o perfil, liga um CV pronto do perfil (deixa de ser presumido) e recusa CV de outro perfil", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    const { profileId } = seedFixture(repos, "engineer");
    const { profileId: other } = seedFixture(repos, "leader");
    const posting = repos.postings.create({ company: "Acme", title: "Dev" }, { source: "user" });
    const app = repos.jobApplications.create({
      postingId: posting.id,
      profileId: null,
      cvVersionId: null,
      coverLetterVersionId: null,
      appliedOn: "2026-11-01",
      stages: ["Triagem"],
      source: "email",
      profilePending: true,
    });
    const cvOf = (pid: string) => {
      const d = repos.documents.create({
        kind: "cv",
        profileId: pid,
        postingId: posting.id,
        templateId: "classico",
        paper: "A4",
        locale: "pt-BR",
        format: "pdf",
      });
      const v = repos.documents.addVersion(d.id, {
        source: "agent",
        instructions: null,
        factsVersion: 1,
        postingUpdatedAt: null,
        profileHash: "h",
      });
      repos.documents.updateVersion(v.id, { status: "ready" });
      return v.id;
    };
    const mine = cvOf(profileId);
    const theirs = cvOf(other);
    const a = setJobApplicationProfileAndCv(repos, app.id, { profileId, cvVersionId: mine });
    expect(a).toMatchObject({ profileId, profilePending: false, cvPresumed: false });
    expect(a.cv?.versionId).toBe(mine);
    expect(() => setJobApplicationProfileAndCv(repos, app.id, { cvVersionId: theirs })).toThrow(
      /outro perfil/,
    );
    // trocar o perfil tira o CV do perfil anterior
    const b = setJobApplicationProfileAndCv(repos, app.id, { profileId: other });
    expect(b).toMatchObject({ profileId: other, cv: null });
  });
});
