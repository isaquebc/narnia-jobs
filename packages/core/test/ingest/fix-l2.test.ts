import type { FactProposal } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, type Repos } from "../../src/db";
import { markRunOpened, syncRunNotifications } from "../../src/ingest/notify";
import { applyReconciliation } from "../../src/ingest/reconcile";
import { seedFixture } from "../../src/testing/profile-fixtures";

/** Plano de correções da auditoria F03, lote L2 (itens 6 e 7). */
function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos: Repos = createRepos(db);
  const ids = seedFixture(repos, "engineer");
  const file = repos.sourceFiles.insert({
    mime: "text/plain",
    size: 1,
    sha256: "s",
    path: "p",
    kind: "cv",
  });
  const run = repos.ingestionRuns.create({
    fileId: file.id,
    provider: "mock",
    models: { document: "h", facts: "h", digest: "s" },
    options: { ocr: false, modelRead: false },
  });
  return { repos, ids, run };
}

describe("F03 fix L2 · item 6: editar proposta 'já existe' atualiza o fato", () => {
  it("aceitar com edição sobre match=existing grava os campos no fato, cria fonte e incrementa facts_version", () => {
    const { repos, ids, run } = setup();
    const current = repos.facts.experiences.get(ids.experienceIds[0] as string);
    if (!current) throw new Error("fixture sem experiência");
    const same: FactProposal = {
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
    };
    repos.proposals.insertMany(run.id, [same]);
    applyReconciliation(repos, run.id, new Date("2026-10-01T00:00:00Z"));
    const [p] = repos.proposals.listByRun(run.id);
    expect(p?.match).toBe("existing");
    const before = repos.settings.getFactsVersion();
    const r = repos.proposals.review(run.id, [
      { proposalId: p?.id as string, decision: "edit", editedData: { title: "Staff Engineer" } },
    ]);
    expect(r.edited).toBe(1);
    expect(r.sourceId).not.toBeNull();
    expect(repos.facts.experiences.get(current.id)?.title).toBe("Staff Engineer");
    expect(repos.settings.getFactsVersion()).toBeGreaterThan(before);
  });
});

describe("F03 fix L2 · item 7: 'ingestão concluída' é informativa", () => {
  it("countUnresolved ignora ingestion.done e abrir a execução a resolve", () => {
    const { repos, run } = setup();
    repos.ingestionRuns.setStatus(run.id, "done");
    syncRunNotifications(repos, run.id);
    const done = repos.notifications
      .list({ status: "open" })
      .find((n) => n.kind === "ingestion.done");
    expect(done).toBeDefined();
    expect(repos.notifications.countUnresolved()).toBe(0);
    const events = markRunOpened(repos, run.id);
    expect(events.map((e) => e.notification.kind)).toEqual(["ingestion.done"]);
    expect(
      repos.notifications.list({ status: "open" }).some((n) => n.kind === "ingestion.done"),
    ).toBe(false);
  });

  it("ingestion.done com mais de 7 dias é resolvida pela expiração", () => {
    const { repos, run } = setup();
    repos.ingestionRuns.setStatus(run.id, "done");
    syncRunNotifications(repos, run.id);
    const expired = repos.notifications.expireInformational(new Date(Date.now() + 8 * 86_400_000));
    expect(expired.map((n) => n.kind)).toEqual(["ingestion.done"]);
    expect(repos.notifications.list({ status: "open" })).toEqual([]);
  });
});
