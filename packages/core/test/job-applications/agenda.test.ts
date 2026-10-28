import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import {
  addJobApplicationEvent,
  applyToPosting,
  JobApplicationError,
  jobApplicationFunnel,
  removeJobApplicationEvent,
  upcomingJobApplicationEvents,
  updateJobApplicationEvent,
} from "../../src/job-applications";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * F07/M5 · agenda das etapas (data e hora no fuso da pessoa, gravadas em UTC com o fuso), lembretes (próximas 24 h e
 * atrasadas) e funil (quantas em cada coluna, quantas chegaram, taxa de avanço e tempo médio em cada coluna).
 */
function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const r = createRepos(db);
  const { profileId } = seedFixture(r, "engineer");
  const apply = (company: string, at: Date) => {
    const p = r.postings.create({ company, title: "Backend" }, { source: "user" });
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
    return applyToPosting(
      r,
      { postingId: p.id, cvVersionId: v.id, appliedOn: at.toISOString().slice(0, 10) },
      at,
    );
  };
  return { r, apply };
}

const at = (iso: string) => new Date(iso);

describe("F07/M5 · agenda", () => {
  it("grava em UTC com o fuso; SEQUENCE sobe a cada edição; concluir e apagar", () => {
    const { r, apply } = setup();
    const app = apply("Acme", at("2026-10-20T12:00:00Z"));
    const ev = addJobApplicationEvent(r, app.id, {
      kind: "interview",
      title: "Entrevista técnica",
      startsLocal: "2026-10-29T14:00",
      timezone: "America/Sao_Paulo",
      durationMin: 60,
      stageId: app.stages[3]?.id ?? null,
    });
    expect(ev).toMatchObject({
      startsAt: "2026-10-29T17:00:00.000Z",
      timezone: "America/Sao_Paulo",
      icsSequence: 0,
      stageId: app.stages[3]?.id,
      doneAt: null,
    });
    const moved = updateJobApplicationEvent(r, app.id, ev.id, {
      startsLocal: "2026-10-29T15:30",
      timezone: "America/Sao_Paulo",
    });
    expect(moved).toMatchObject({ startsAt: "2026-10-29T18:30:00.000Z", icsSequence: 1 });
    const done = updateJobApplicationEvent(
      r,
      app.id,
      ev.id,
      { done: true },
      at("2026-10-29T19:00:00Z"),
    );
    expect(done.doneAt).toBe("2026-10-29T19:00:00.000Z");
    expect(r.jobApplicationEvents.list(app.id)).toHaveLength(1);
    removeJobApplicationEvent(r, app.id, ev.id);
    expect(r.jobApplicationEvents.list(app.id)).toHaveLength(0);
  });

  it("etapa de outra candidatura, fuso ou hora inválidos são recusados", () => {
    const { r, apply } = setup();
    const a = apply("Acme", at("2026-10-20T12:00:00Z"));
    const b = apply("Beta", at("2026-10-20T12:00:00Z"));
    const base = {
      kind: "interview" as const,
      title: "X",
      durationMin: 60,
      timezone: "America/Sao_Paulo",
    };
    expect(() =>
      addJobApplicationEvent(r, a.id, {
        ...base,
        startsLocal: "2026-10-29T14:00",
        stageId: b.stages[0]?.id ?? null,
      }),
    ).toThrow(JobApplicationError);
    expect(() =>
      addJobApplicationEvent(r, a.id, { ...base, startsLocal: "29/10 14h", stageId: null }),
    ).toThrow(JobApplicationError);
  });

  it("lembretes: nas próximas 24 h e atrasadas (não concluídas), independe do fuso", () => {
    const { r, apply } = setup();
    const app = apply("Acme", at("2026-10-20T12:00:00Z"));
    const add = (startsLocal: string, timezone: string, title: string) =>
      addJobApplicationEvent(r, app.id, {
        kind: "interview",
        title,
        startsLocal,
        timezone,
        durationMin: 30,
        stageId: null,
      });
    add("2026-10-28T11:00", "America/Sao_Paulo", "em 2 h"); // 14:00Z
    add("2026-10-28T13:00", "Europe/Lisbon", "em 1 h"); // 13:00Z
    add("2026-10-27T09:00", "America/Sao_Paulo", "ontem"); // atrasada
    add("2026-11-05T09:00", "America/Sao_Paulo", "longe");
    const done = add("2026-10-27T10:00", "America/Sao_Paulo", "feita");
    updateJobApplicationEvent(r, app.id, done.id, { done: true });
    const u = upcomingJobApplicationEvents(r, { hours: 24 }, at("2026-10-28T12:00:00Z"));
    expect(u.upcoming.map((x) => x.event.title)).toEqual(["em 1 h", "em 2 h"]);
    expect(u.overdue.map((x) => x.event.title)).toEqual(["ontem"]);
    expect(u.upcoming[0]?.application).toMatchObject({ id: app.id, company: "Acme" });
  });

  it("encerrada ou arquivada não lembra", () => {
    const { r, apply } = setup();
    const app = apply("Acme", at("2026-10-20T12:00:00Z"));
    addJobApplicationEvent(r, app.id, {
      kind: "deadline",
      title: "Entregar case",
      startsLocal: "2026-10-28T11:00",
      timezone: "America/Sao_Paulo",
      durationMin: 30,
      stageId: null,
    });
    r.jobApplications.update(app.id, { column: "closed", closedReason: "withdrew" });
    const u = upcomingJobApplicationEvents(r, { hours: 24 }, at("2026-10-28T12:00:00Z"));
    expect(u.upcoming).toEqual([]);
  });
});

describe("F07/M5 · funil", () => {
  it("contagem atual, quantas chegaram a cada coluna, taxa de avanço e dias médios", () => {
    const { r, apply } = setup();
    const a = apply("A", at("2026-10-01T12:00:00Z"));
    const b = apply("B", at("2026-10-01T12:00:00Z"));
    const c = apply("C", at("2026-10-01T12:00:00Z"));
    apply("D", at("2026-10-01T12:00:00Z"));
    r.jobApplications.update(a.id, { column: "first_interview" }, at("2026-10-05T12:00:00Z"));
    r.jobApplications.update(a.id, { column: "in_process" }, at("2026-10-07T12:00:00Z"));
    r.jobApplications.update(b.id, { column: "first_interview" }, at("2026-10-09T12:00:00Z"));
    // pular colunas conta como ter passado por elas
    r.jobApplications.update(c.id, { column: "offer" }, at("2026-10-11T12:00:00Z"));
    r.jobApplications.update(
      b.id,
      { column: "closed", closedReason: "rejected" },
      at("2026-10-12T12:00:00Z"),
    );
    const f = jobApplicationFunnel(r);
    expect(f.total).toBe(4);
    const col = (k: string) => f.columns.find((x) => x.column === k);
    // dias médios só das passagens que terminaram: Aplicado (4 + 8 + 10) / 3; 1ª Entrevista (2 + 3) / 2
    expect(col("applied")).toMatchObject({ now: 1, reached: 4, avgDays: 7.3 });
    expect(col("first_interview")).toMatchObject({ now: 0, reached: 3, avgDays: 2.5 });
    expect(col("in_process")).toMatchObject({ now: 1, reached: 2 });
    expect(col("offer")).toMatchObject({ now: 1, reached: 1 });
    expect(col("closed")).toMatchObject({ now: 1, reached: 1 });
    expect(f.closedReasons).toEqual({ rejected: 1 });
    expect(f.rates).toEqual([
      { from: "applied", to: "first_interview", rate: 0.75 },
      { from: "first_interview", to: "in_process", rate: 2 / 3 },
      { from: "in_process", to: "offer", rate: 0.5 },
    ]);
  });

  it("sem candidaturas não divide por zero", () => {
    const { r } = setup();
    const f = jobApplicationFunnel(r);
    expect(f.total).toBe(0);
    expect(f.rates.every((x) => x.rate === null)).toBe(true);
    expect(f.columns.every((x) => x.avgDays === null)).toBe(true);
  });
});
