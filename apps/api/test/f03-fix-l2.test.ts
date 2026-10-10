import {
  applyReconciliation,
  INGEST_SETTING_KEYS,
  seedFixture,
  syncRunNotifications,
} from "@narnia-jobs/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/** Plano de correções F03, lote L2 (itens 6, 7 e 8 na api). */
// biome-ignore lint/suspicious/noExplicitAny: corpo lido de forma solta
type Body = any;

function cvRun(t: TestApp) {
  const file = t.repos.sourceFiles.insert({
    mime: "text/plain",
    size: 1,
    sha256: "fx",
    path: "p",
    kind: "cv",
  });
  return t.repos.ingestionRuns.create({
    fileId: file.id,
    provider: "mock",
    models: { document: "h", facts: "h", digest: "s" },
    options: { ocr: false, modelRead: false },
  });
}

describe("F03 fix L2 · api", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("item 6: review com edição sobre fato existente atualiza o fato", async () => {
    t = makeTestApp();
    const ids = seedFixture(t.repos, "engineer");
    const current = t.repos.facts.experiences.get(ids.experienceIds[0] as string);
    if (!current) throw new Error("fixture");
    const run = cvRun(t);
    t.repos.proposals.insertMany(run.id, [
      {
        kind: "experience",
        confidence: 0.9,
        data: {
          company: current.company,
          title: current.title,
          startDate: current.startDate,
          ...(current.endDate ? { endDate: current.endDate } : {}),
          isCurrent: current.isCurrent,
          tech: current.tech ?? [],
        },
      },
    ]);
    applyReconciliation(t.repos, run.id);
    t.repos.ingestionRuns.setStatus(run.id, "review");
    const [p] = t.repos.proposals.listByRun(run.id);
    const res = await t.api(`/api/ingestions/${run.id}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decisions: [
          { proposalId: p?.id, decision: "edited", editedData: { title: "Staff Engineer" } },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Body).edited).toBe(1);
    expect(t.repos.facts.experiences.get(current.id)?.title).toBe("Staff Engineer");
  });

  it("item 7: 'concluída' fora do contador; abrir a execução a resolve e avisa por WS", async () => {
    t = makeTestApp();
    const run = cvRun(t);
    t.repos.ingestionRuns.setStatus(run.id, "done");
    syncRunNotifications(t.repos, run.id);
    const list = (await (await t.api("/api/notifications")).json()) as Body;
    expect(list.unresolved).toBe(0);
    expect(list.notifications.map((n: Body) => n.kind)).toContain("ingestion.done");
    t.events.length = 0;
    expect((await t.api(`/api/ingestions/${run.id}`)).status).toBe(200);
    expect(
      t.events.some(
        (e: Body) => e.type === "notification.updated" && e.notification.kind === "ingestion.done",
      ),
    ).toBe(true);
    const after = (await (await t.api("/api/notifications")).json()) as Body;
    expect(after.notifications.map((n: Body) => n.kind)).not.toContain("ingestion.done");
  });

  it("item 8: GET /api/settings/ingest expõe a conversão aprendida % → tokens por modelo", async () => {
    t = makeTestApp();
    expect(((await (await t.api("/api/settings/ingest")).json()) as Body).pctToTokens).toEqual({});
    t.repos.settings.set(INGEST_SETTING_KEYS.pctToTokens, { sonnet: 14000 });
    expect(((await (await t.api("/api/settings/ingest")).json()) as Body).pctToTokens).toEqual({
      sonnet: 14000,
    });
  });
});
