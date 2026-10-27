import { applyToPosting, seedFixture } from "@narnia-jobs/core";
import type { PostingListItem, SavedPostingCard } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * F07 (pedido do dono 2026-10-27): a lista de vagas traz a candidatura de cada uma (destaque das aplicadas) e separa as
 * arquivadas; arquivar a vaga pede o motivo e não vale com candidatura ativa; o quadro ganha a coluna "Vagas salvas".
 */
type Body = {
  postings: PostingListItem[];
  saved: SavedPostingCard[];
  posting: PostingListItem;
  error: { code: string };
};
const body = async (r: Response | Promise<Response>) => (await (await r).json()) as Body;
const post = (b: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(b),
});

function seed(t: TestApp) {
  const { profileId } = seedFixture(t.repos, "engineer");
  const mk = (company: string) => t.repos.postings.create({ company }, { source: "user" });
  const apply = (postingId: string) => {
    const d = t.repos.documents.create({
      kind: "cv",
      profileId,
      postingId,
      templateId: "classico",
      paper: "A4",
      locale: "pt-BR",
      format: "pdf",
    });
    const v = t.repos.documents.addVersion(d.id, {
      source: "agent",
      instructions: null,
      factsVersion: 1,
      postingUpdatedAt: null,
      profileHash: "h",
    });
    t.repos.documents.updateVersion(v.id, { status: "ready" });
    return applyToPosting(t.repos, { postingId, cvVersionId: v.id, appliedOn: "2026-10-27" });
  };
  return { mk, apply };
}

describe("F07 · vagas salvas, destaque e arquivar a vaga", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  it("a lista de vagas traz a candidatura de cada uma", async () => {
    t = makeTestApp();
    const s = seed(t);
    const a = s.mk("Acme");
    const b = s.mk("Beta");
    const app = s.apply(b.id);
    const { postings } = await body(t.api("/api/postings"));
    const byId = Object.fromEntries(postings.map((p) => [p.id, p.application]));
    expect(byId[a.id]).toBeNull();
    expect(byId[b.id]).toEqual({ id: app.id, column: "applied", archived: false });
  });

  it("arquivar pede o motivo, sai da lista e das vagas salvas; desarquivar volta", async () => {
    t = makeTestApp();
    const s = seed(t);
    const a = s.mk("Acme");
    expect((await t.api(`/api/postings/${a.id}/archive`, post({}))).status).toBe(400);
    const res = await t.api(
      `/api/postings/${a.id}/archive`,
      post({ reason: "salary", note: "Abaixo do piso" }),
    );
    expect(res.status).toBe(200);
    expect((await body(res)).posting).toMatchObject({
      archiveReason: "salary",
      archiveNote: "Abaixo do piso",
    });
    expect(t.events).toContainEqual({ type: "posting.updated", postingId: a.id });
    expect((await body(t.api("/api/postings"))).postings).toEqual([]);
    expect((await body(t.api("/api/postings?archived=1"))).postings.map((p) => p.id)).toEqual([
      a.id,
    ]);
    expect((await body(t.api("/api/job-applications"))).saved).toEqual([]);
    expect((await body(t.api("/api/job-applications?archived=1"))).saved.map((p) => p.id)).toEqual([
      a.id,
    ]);
    await t.api(`/api/postings/${a.id}/unarchive`, post({}));
    expect((await body(t.api("/api/job-applications"))).saved.map((p) => p.id)).toEqual([a.id]);
  });

  it("vaga com candidatura ativa não é arquivada (a candidatura se encerra ou arquiva antes)", async () => {
    t = makeTestApp();
    const s = seed(t);
    const a = s.mk("Acme");
    s.apply(a.id);
    const res = await t.api(`/api/postings/${a.id}/archive`, post({ reason: "stack" }));
    expect(res.status).toBe(409);
    expect((await body(res)).error.code).toBe("has_active_application");
  });
});
