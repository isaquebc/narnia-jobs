import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase } from "../../src/db";
import {
  ARCHIVE_AFTER_DAYS,
  applyOptions,
  applyToPosting,
  DEFAULT_STAGES,
  JobApplicationError,
  listJobApplications,
} from "../../src/job-applications";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * F07/M1 · candidaturas (§0, requisitos do dono 2026-10-27): só o "Aplicar" cria a candidatura, com a vaga, a versão
 * do CV (obrigatória) e a da carta travadas e a data escolhida; uma ativa por vaga; colunas independentes do pipeline;
 * 40 dias sem atividade arquiva; busca por empresa, cliente, cargo, data e contato.
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
  const posting = r.postings.create(
    { company: "Acme", client: "Banco Azul", title: "Backend Sr" },
    { source: "user" },
  );
  /** Documento com versões nos estados pedidos; devolve os ids das versões. */
  const doc = (
    kind: "cv" | "cover_letter",
    postingId: string | null,
    statuses: Array<"ready" | "ready_with_issues" | "generating" | "error">,
  ) => {
    const d = r.documents.create({ kind, profileId, postingId, ...base });
    const ids = statuses.map((status) => {
      const v = r.documents.addVersion(d.id, versionInput);
      r.documents.updateVersion(v.id, { status });
      return v.id;
    });
    return { documentId: d.id, versionIds: ids };
  };
  return { db, r, profileId, posting, doc };
}

describe("F07/M1 · opções do Aplicar", () => {
  it("só versões prontas (com ou sem avisos) do CV da vaga e do CV geral; a mais nova primeiro; carta à parte", () => {
    const { r, posting, doc } = setup();
    const vaga = doc("cv", posting.id, ["ready", "ready_with_issues", "generating"]);
    const geral = doc("cv", null, ["error", "ready"]);
    const carta = doc("cover_letter", posting.id, ["ready"]);
    const opts = applyOptions(r, posting.id);
    expect(opts.cvs.map((o) => [o.versionId, o.version, o.scope])).toEqual([
      [vaga.versionIds[1], 2, "posting"],
      [vaga.versionIds[0], 1, "posting"],
      [geral.versionIds[1], 2, "profile"],
    ]);
    expect(opts.coverLetters.map((o) => o.versionId)).toEqual(carta.versionIds);
    expect(opts.activeApplicationId).toBeNull();
  });
});

describe("F07/M1 · aplicar", () => {
  it("cria com as versões travadas, a data escolhida, a coluna Aplicado e o pipeline padrão na etapa 1", () => {
    const { r, posting, profileId, doc } = setup();
    const cv = doc("cv", posting.id, ["ready"]);
    const carta = doc("cover_letter", posting.id, ["ready"]);
    const now = new Date("2026-10-27T15:00:00.000Z");
    const app = applyToPosting(
      r,
      {
        postingId: posting.id,
        cvVersionId: cv.versionIds[0] as string,
        coverLetterVersionId: carta.versionIds[0] as string,
        appliedOn: "2026-10-26",
      },
      now,
    );
    expect(app).toMatchObject({
      postingId: posting.id,
      profileId,
      appliedOn: "2026-10-26",
      column: "applied",
      closedReason: null,
      archivedAt: null,
      lastActivityAt: now.toISOString(),
      cv: { documentId: cv.documentId, versionId: cv.versionIds[0], version: 1, scope: "posting" },
      coverLetter: { versionId: carta.versionIds[0] },
    });
    expect(app.stages.map((s) => [s.position, s.name])).toEqual(
      DEFAULT_STAGES.map((name, i) => [i + 1, name]),
    );
    expect(app.currentStageId).toBe(app.stages[0]?.id);

    // regerar o CV depois não muda o que foi enviado
    r.documents.addVersion(cv.documentId, versionInput);
    expect(r.jobApplications.get(app.id)?.cv.version).toBe(1);
  });

  it("CV é obrigatório e precisa estar pronto e ser desta vaga ou o geral; carta de outra vaga não vale", () => {
    const s0 = setup();
    const { r, posting, doc } = s0;
    const other = r.postings.create({ company: "Outra" }, { source: "user" });
    const cvOther = doc("cv", other.id, ["ready"]);
    const cvBusy = doc("cv", posting.id, ["generating"]);
    const geral = doc("cv", null, ["ready"]);
    const cartaOther = doc("cover_letter", other.id, ["ready"]);
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e instanceof JobApplicationError ? e.code : String(e);
      }
      return "ok";
    };
    const input = { postingId: posting.id, appliedOn: "2026-10-27" };
    expect(code(() => applyToPosting(r, { ...input, cvVersionId: "" }))).toBe("cv_required");
    expect(code(() => applyToPosting(r, { ...input, cvVersionId: "nada" }))).toBe("cv_required");
    expect(
      code(() => applyToPosting(r, { ...input, cvVersionId: cvBusy.versionIds[0] as string })),
    ).toBe("version_not_ready");
    expect(
      code(() => applyToPosting(r, { ...input, cvVersionId: cvOther.versionIds[0] as string })),
    ).toBe("wrong_posting");
    expect(
      code(() =>
        applyToPosting(r, {
          ...input,
          cvVersionId: geral.versionIds[0] as string,
          coverLetterVersionId: cartaOther.versionIds[0] as string,
        }),
      ),
    ).toBe("wrong_posting");
    expect(
      code(() =>
        applyToPosting(
          r,
          { ...input, cvVersionId: geral.versionIds[0] as string, appliedOn: "2026-10-29" },
          new Date("2026-10-27T15:00:00.000Z"),
        ),
      ),
    ).toBe("future_date");
    expect(
      code(() =>
        applyToPosting(r, { ...input, postingId: "x", cvVersionId: geral.versionIds[0] as string }),
      ),
    ).toBe("posting_not_found");
    // vaga esperando a decisão de duplicata (F06-9) pode ser apagada: decidir antes
    const dup = s0.r.postings.create({ company: "Acme" }, { source: "user" });
    s0.r.postings.setDuplicate(dup.id, {
      candidateId: posting.id,
      sameJob: true,
      confidence: 90,
      differences: [],
      rationale: "",
      checkedAt: "2026-10-27T12:00:00.000Z",
      decision: null,
    });
    expect(
      code(() =>
        applyToPosting(r, {
          ...input,
          postingId: dup.id,
          cvVersionId: geral.versionIds[0] as string,
        }),
      ),
    ).toBe("duplicate_pending");
    // o CV geral do perfil vale
    const app = applyToPosting(r, { ...input, cvVersionId: geral.versionIds[0] as string });
    expect(app.cv.scope).toBe("profile");
  });

  it("uma candidatura ativa por vaga; encerrada ou arquivada deixa aplicar de novo", () => {
    const { r, posting, doc } = setup();
    const cv = doc("cv", posting.id, ["ready"]);
    const input = {
      postingId: posting.id,
      cvVersionId: cv.versionIds[0] as string,
      appliedOn: "2026-10-27",
    };
    const first = applyToPosting(r, input);
    expect(applyOptions(r, posting.id).activeApplicationId).toBe(first.id);
    let err: unknown;
    try {
      applyToPosting(r, input);
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: "already_applied", applicationId: first.id });
    r.jobApplications.update(first.id, { column: "closed", closedReason: "rejected" });
    const second = applyToPosting(r, input);
    r.jobApplications.update(second.id, { archived: true });
    expect(applyToPosting(r, input).id).not.toBe(second.id);
  });
});

describe("F07/M1 · coluna, atividade e arquivamento", () => {
  const apply = (s: ReturnType<typeof setup>, at: Date) => {
    const cv = s.doc("cv", s.posting.id, ["ready"]);
    return applyToPosting(
      s.r,
      { postingId: s.posting.id, cvVersionId: cv.versionIds[0] as string, appliedOn: "2026-09-01" },
      at,
    );
  };

  it("mover de coluna não mexe no pipeline; encerrar guarda o motivo e reabrir o limpa", () => {
    const s = setup();
    const app = apply(s, new Date("2026-10-01T12:00:00.000Z"));
    const moved = s.r.jobApplications.update(
      app.id,
      { column: "in_process" },
      new Date("2026-10-02T12:00:00.000Z"),
    );
    expect(moved).toMatchObject({
      column: "in_process",
      currentStageId: app.currentStageId,
      lastActivityAt: "2026-10-02T12:00:00.000Z",
    });
    expect(
      s.r.jobApplications.update(app.id, { column: "closed", closedReason: "withdrew" }),
    ).toMatchObject({ column: "closed", closedReason: "withdrew" });
    expect(s.r.jobApplications.update(app.id, { column: "offer" })).toMatchObject({
      column: "offer",
      closedReason: null,
    });
    expect(() => s.r.jobApplications.update(app.id, { column: "closed" })).toThrow();
  });

  it(`${ARCHIVE_AFTER_DAYS} dias sem atividade arquiva (sem apagar); atividade nova desarquiva`, () => {
    const s = setup();
    const old = apply(s, new Date("2026-09-01T12:00:00.000Z"));
    const other = s.r.postings.create({ company: "Beta" }, { source: "user" });
    const cv = s.doc("cv", other.id, ["ready"]);
    const recent = applyToPosting(
      s.r,
      { postingId: other.id, cvVersionId: cv.versionIds[0] as string, appliedOn: "2026-10-20" },
      new Date("2026-10-20T12:00:00.000Z"),
    );
    const now = new Date("2026-10-27T12:00:00.000Z");
    expect(s.r.jobApplications.archiveInactive(now)).toEqual([old.id]);
    expect(s.r.jobApplications.get(old.id)?.archivedAt).toBe(now.toISOString());
    expect(s.r.jobApplications.get(recent.id)?.archivedAt).toBeNull();
    expect(s.r.jobApplications.archiveInactive(now)).toEqual([]);
    s.r.jobApplications.update(old.id, { column: "first_interview" }, now);
    expect(s.r.jobApplications.get(old.id)?.archivedAt).toBeNull();
    // desarquivar à mão também conta como atividade (não volta a arquivar na hora)
    s.r.jobApplications.update(recent.id, { archived: true }, now);
    s.r.jobApplications.update(recent.id, { archived: false }, now);
    expect(s.r.jobApplications.archiveInactive(now)).toEqual([]);
  });
});

describe("F07/M1 · lista e busca", () => {
  it("separa ativas e arquivadas; busca por empresa, cliente, cargo, data e contato", () => {
    const s = setup();
    s.r.postingContacts.add(s.posting.id, { name: "Maria Souza", origin: "linkedin" });
    const cv = s.doc("cv", s.posting.id, ["ready"]);
    const a = applyToPosting(s.r, {
      postingId: s.posting.id,
      cvVersionId: cv.versionIds[0] as string,
      appliedOn: "2026-10-15",
    });
    const beta = s.r.postings.create({ company: "Beta", title: "Frontend" }, { source: "user" });
    const cv2 = s.doc("cv", beta.id, ["ready"]);
    const b = applyToPosting(s.r, {
      postingId: beta.id,
      cvVersionId: cv2.versionIds[0] as string,
      appliedOn: "2026-09-03",
    });
    s.r.jobApplications.update(b.id, { archived: true });
    const ids = (q?: string, archived = false) =>
      listJobApplications(s.r, { q, archived }).map((x) => x.id);
    expect(ids()).toEqual([a.id]);
    expect(ids(undefined, true)).toEqual([b.id]);
    for (const q of ["acme", "BANCO azul", "backend", "maria", "15/10", "2026-10-15", "10/2026"])
      expect(ids(q), q).toEqual([a.id]);
    expect(ids("frontend", true)).toEqual([b.id]);
    expect(ids("nada disso")).toEqual([]);
    const [row] = listJobApplications(s.r, {});
    expect(row).toMatchObject({
      posting: { company: "Acme", client: "Banco Azul", title: "Backend Sr" },
      contacts: ["Maria Souza"],
      progress: { current: 1, total: DEFAULT_STAGES.length },
    });
  });
});

describe("F07/M1 · o que foi enviado fica guardado", () => {
  it("vaga ou documento com candidatura não podem ser apagados (o banco recusa)", () => {
    const s = setup();
    const cv = s.doc("cv", s.posting.id, ["ready"]);
    applyToPosting(s.r, {
      postingId: s.posting.id,
      cvVersionId: cv.versionIds[0] as string,
      appliedOn: "2026-10-27",
    });
    expect(s.r.jobApplications.countForPosting(s.posting.id)).toBe(1);
    expect(s.r.jobApplications.countForDocument(cv.documentId)).toBe(1);
    expect(() => s.r.postings.remove(s.posting.id)).toThrow();
    expect(() => s.r.documents.remove(cv.documentId)).toThrow();
  });

  it("0027 entra sobre o banco anterior", () => {
    const db = openDatabase(":memory:");
    migrate(db, { until: "0026_application_steps" });
    expect(migrate(db, { until: "0027_job_application" }).applied).toEqual([
      "0027_job_application",
    ]);
  });
});
