import { applyToPosting, seedFixture } from "@narnia-jobs/core";
import type { JobApplicationSummary } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/** F07/M2 · pipeline pela API: trocar as etapas (adicionar, remover, reordenar) e escolher a etapa atual. */
const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
type Body = { application: JobApplicationSummary; error: { code: string } };
const body = async (r: Response | Promise<Response>) => (await (await r).json()) as Body;

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
    appliedOn: "2026-10-27",
  });
}

describe("F07/M2 · API do pipeline", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  it("PUT das etapas troca o pipeline e o x/N acompanha; PATCH escolhe a etapa atual", async () => {
    t = makeTestApp();
    const app = seed(t);
    const [a, b] = app.stages;
    const put = await body(
      t.api(
        `/api/job-applications/${app.id}/stages`,
        json(
          {
            stages: [
              { id: b?.id, name: b?.name },
              { name: "Pair programming" },
              { id: a?.id, name: a?.name },
            ],
          },
          "PUT",
        ),
      ),
    );
    expect(put.application.stages.map((s) => s.name)).toEqual([
      b?.name,
      "Pair programming",
      a?.name,
    ]);
    expect(put.application.progress).toEqual({ current: 3, total: 3 });
    const pair = put.application.stages[1]?.id;
    const patched = await body(
      t.api(`/api/job-applications/${app.id}`, json({ currentStageId: pair }, "PATCH")),
    );
    expect(patched.application.progress).toEqual({ current: 2, total: 3 });
  });

  it("etapa de fora, nome vazio ou candidatura inexistente", async () => {
    t = makeTestApp();
    const app = seed(t);
    const bad = await t.api(
      `/api/job-applications/${app.id}/stages`,
      json({ stages: [{ id: "x".repeat(10), name: "X" }] }, "PUT"),
    );
    expect(bad.status).toBe(400);
    expect((await body(bad)).error.code).toBe("stage_not_found");
    expect(
      (
        await t.api(
          `/api/job-applications/${app.id}/stages`,
          json({ stages: [{ name: " " }] }, "PUT"),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await t.api(
          `/api/job-applications/${app.id}`,
          json({ currentStageId: "nao-existe" }, "PATCH"),
        )
      ).status,
    ).toBe(400);
    expect(
      (await t.api("/api/job-applications/nao-existe/stages", json({ stages: [] }, "PUT"))).status,
    ).toBe(404);
  });
});
