import { applyToPosting, seedFixture } from "@narnia-jobs/core";
import type { JobApplicationEntry, JobApplicationSummary } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/** Desclassificação pela API (pedido do dono, 2026-10-29): o e-mail colado vira nota e a candidatura se encerra. */
type Body = {
  application: JobApplicationSummary;
  entries: JobApplicationEntry[];
  error: { code: string };
};
const body = async (r: Response | Promise<Response>) => (await (await r).json()) as Body;
const post = (json: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(json),
});

function seed(t: TestApp) {
  const { profileId } = seedFixture(t.repos, "engineer");
  const posting = t.repos.postings.create(
    { company: "Acme", title: "Backend" },
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
  return applyToPosting(t.repos, {
    postingId: posting.id,
    cvVersionId: v.id,
    appliedOn: "2026-10-20",
  });
}

describe("desclassificação pela API", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  it("encerra como reprovada na etapa e guarda o e-mail; de novo é 409; etapa de fora é 400", async () => {
    t = makeTestApp();
    const app = seed(t);
    const stage = app.stages[0];
    const res = await t.api(
      `/api/job-applications/${app.id}/reject`,
      post({ occurredOn: "2026-10-22", message: "Processo finalizado.", stageId: stage?.id }),
    );
    expect(res.status).toBe(200);
    const { application } = await body(res);
    expect(application).toMatchObject({
      column: "closed",
      closedReason: "rejected",
      closedStage: stage?.name,
    });
    const { entries } = await body(t.api(`/api/job-applications/${app.id}/entries`));
    expect(entries.map((e) => [e.id, e.body])).toEqual([
      [application.closedEntryId, "Processo finalizado."],
    ]);
    const again = await t.api(
      `/api/job-applications/${app.id}/reject`,
      post({ occurredOn: "2026-10-22", message: "x", stageId: null }),
    );
    expect(again.status).toBe(409);
    const other = seed(t);
    const bad = await t.api(
      `/api/job-applications/${other.id}/reject`,
      post({ occurredOn: "2026-10-22", message: "x", stageId: "nao-existe" }),
    );
    expect(bad.status).toBe(400);
    expect((await body(bad)).error.code).toBe("stage_not_found");
    const missing = await t.api(
      "/api/job-applications/nao-existe/reject",
      post({ occurredOn: "2026-10-22", message: "x", stageId: null }),
    );
    expect(missing.status).toBe(404);
  });
});
