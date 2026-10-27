import { seedFixture } from "@narnia-jobs/core";
import type { ApplyOptions, JobApplicationSummary } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { archiveJobApplicationsNow } from "../src/routes/job-applications";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * F07/M1 · candidaturas pela API (§0): opções do Aplicar (versões prontas e a candidatura ativa), criar só com CV,
 * mover de coluna, encerrar com motivo, arquivar e desarquivar, lista com busca, e a vaga ou o documento enviado não
 * podem ser apagados.
 */
const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

type Body = ApplyOptions & {
  application: JobApplicationSummary;
  applications: JobApplicationSummary[];
  error: { code: string; details?: unknown };
};
const body = async (r: Response | Promise<Response>) => (await (await r).json()) as Body;

function seed(t: TestApp) {
  const { profileId } = seedFixture(t.repos, "engineer");
  const posting = t.repos.postings.create(
    { company: "Acme", title: "Backend Sr" },
    { source: "user" },
  );
  const doc = t.repos.documents.create({
    kind: "cv",
    profileId,
    postingId: posting.id,
    templateId: "classico",
    paper: "A4",
    locale: "pt-BR",
    format: "pdf",
  });
  const v = t.repos.documents.addVersion(doc.id, {
    source: "agent",
    instructions: null,
    factsVersion: 1,
    postingUpdatedAt: null,
    profileHash: "h",
  });
  t.repos.documents.updateVersion(v.id, { status: "ready" });
  return { profileId, posting, doc, versionId: v.id };
}

describe("F07/M1 · API das candidaturas", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  it("Aplicar: opções, criar, já aplicada (409 com o id), CV obrigatório", async () => {
    t = makeTestApp();
    const s = seed(t);
    const opts = await body(t.api(`/api/postings/${s.posting.id}/apply-options`));
    expect(opts.cvs.map((o) => o.versionId)).toEqual([s.versionId]);
    expect(opts.activeApplicationId).toBeNull();

    const missing = await t.api(
      "/api/job-applications",
      json({ postingId: s.posting.id, cvVersionId: "nada", appliedOn: "2026-10-27" }),
    );
    expect(missing.status).toBe(400);
    expect((await body(missing)).error.code).toBe("cv_required");

    const res = await t.api(
      "/api/job-applications",
      json({ postingId: s.posting.id, cvVersionId: s.versionId, appliedOn: "2026-10-26" }),
    );
    expect(res.status).toBe(201);
    const { application } = await body(res);
    expect(application).toMatchObject({ appliedOn: "2026-10-26", column: "applied" });
    expect(t.events).toContainEqual({
      type: "job_application.updated",
      applicationId: application.id,
    });

    const again = await t.api(
      "/api/job-applications",
      json({ postingId: s.posting.id, cvVersionId: s.versionId, appliedOn: "2026-10-27" }),
    );
    expect(again.status).toBe(409);
    expect((await body(again)).error).toMatchObject({
      code: "already_applied",
      details: { applicationId: application.id },
    });
  });

  it("mover, encerrar (motivo obrigatório), arquivar e listar com busca", async () => {
    t = makeTestApp();
    const s = seed(t);
    const { application } = await body(
      t.api(
        "/api/job-applications",
        json({ postingId: s.posting.id, cvVersionId: s.versionId, appliedOn: "2026-10-26" }),
      ),
    );
    const url = `/api/job-applications/${application.id}`;
    expect((await t.api(url, json({ column: "closed" }, "PATCH"))).status).toBe(400);
    const moved = await body(t.api(url, json({ column: "first_interview" }, "PATCH")));
    expect(moved.application.column).toBe("first_interview");

    const list = await body(t.api("/api/job-applications?q=acme"));
    expect(list.applications.map((a) => a.id)).toEqual([application.id]);
    expect(list.applications[0]?.posting.title).toBe("Backend Sr");
    expect((await body(t.api("/api/job-applications?q=beta"))).applications).toEqual([]);

    await t.api(url, json({ archived: true }, "PATCH"));
    expect((await body(t.api("/api/job-applications"))).applications).toEqual([]);
    const archived = await body(t.api("/api/job-applications?archived=1"));
    expect(archived.applications).toHaveLength(1);
    expect((await body(t.api(url))).application.id).toBe(application.id);
  });

  it("vaga ou documento enviados numa candidatura: apagar dá 409", async () => {
    t = makeTestApp();
    const s = seed(t);
    await t.api(
      "/api/job-applications",
      json({ postingId: s.posting.id, cvVersionId: s.versionId, appliedOn: "2026-10-26" }),
    );
    const delPosting = await t.api(`/api/postings/${s.posting.id}`, { method: "DELETE" });
    expect(delPosting.status).toBe(409);
    expect((await body(delPosting)).error.code).toBe("has_application");
    const delDoc = await t.api(`/api/documents/${s.doc.id}`, { method: "DELETE" });
    expect(delDoc.status).toBe(409);
    expect(t.repos.postings.get(s.posting.id)).not.toBeNull();
  });

  it("apagar a candidatura libera a vaga; o arquivamento roda pela função do boot", async () => {
    t = makeTestApp();
    const s = seed(t);
    const { application } = await body(
      t.api(
        "/api/job-applications",
        json({ postingId: s.posting.id, cvVersionId: s.versionId, appliedOn: "2026-09-01" }),
      ),
    );
    const later = new Date(Date.now() + 41 * 86_400_000);
    expect(archiveJobApplicationsNow({ repos: t.repos, bus: t.bus }, later)).toBe(1);
    expect(t.repos.jobApplications.get(application.id)?.archivedAt).not.toBeNull();
    const del = await t.api(`/api/job-applications/${application.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect((await t.api(`/api/postings/${s.posting.id}`, { method: "DELETE" })).status).toBe(204);
  });
});
