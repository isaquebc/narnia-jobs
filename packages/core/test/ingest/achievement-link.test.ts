import type { FactProposal } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, type Repos } from "../../src/db";
import { applyReconciliation, existingFacts, reconcileProposals } from "../../src/ingest/reconcile";
import { seedFixture } from "../../src/testing/profile-fixtures";

/**
 * Conquista ligada a uma experiência que já está no perfil (pedido do dono, 2026-10-14): "Liderou 7 pessoas" não
 * precisa que a ingestão proponha a experiência de novo, nem some quando a experiência repetida é rejeitada.
 */
function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos = createRepos(db);
  const ids = seedFixture(repos, "engineer");
  const file = repos.sourceFiles.insert({
    mime: "text/plain",
    size: 1,
    sha256: "t1",
    path: "p",
    kind: "text",
  });
  const run = repos.ingestionRuns.create({
    fileId: file.id,
    provider: "mock",
    models: { document: "h", facts: "h", digest: "s" },
    options: { ocr: false, modelRead: false },
  });
  return { repos, ids, run };
}

const NOW = new Date("2026-10-01T00:00:00Z");
const ach = (data: Record<string, unknown>): FactProposal =>
  ({
    kind: "achievement",
    confidence: 0.8,
    data: { text: "Liderou 7 pessoas", ...data },
  }) as FactProposal;
const acmeAgain: FactProposal = {
  kind: "experience",
  confidence: 0.9,
  data: {
    company: "Acme Pagamentos",
    title: "Engenheira de Software Sênior",
    startDate: "2023-02",
    isCurrent: true,
    tech: [],
  },
};
const achievementsOf = (repos: Repos, expId: string) =>
  repos.facts.achievements.listByExperience(expId).map((a) => a.text);

describe("conquista ligada a uma experiência do perfil", () => {
  it("experienceId de uma experiência do perfil: aceitar grava a conquista nela, sem experiência nova", () => {
    const { repos, ids, run } = setup();
    const acme = ids.experienceIds[0] as string;
    const before = repos.facts.experiences.count();
    const [pid] = repos.proposals.insertMany(run.id, [
      ach({ experienceId: acme, metric: "7 pessoas" }),
    ]);
    const r = repos.proposals.review(run.id, [{ proposalId: pid as string, decision: "accept" }]);
    expect(r.accepted).toBe(1);
    expect(repos.facts.experiences.count()).toBe(before);
    expect(achievementsOf(repos, acme)).toContain("Liderou 7 pessoas");
    expect(repos.proposals.listByRun(run.id)[0]?.decision).toBe("accepted");
  });

  it("experienceId que não existe mais: a conquista é pulada, nada gravado", () => {
    const { repos, run } = setup();
    const total = repos.facts.achievements.count();
    const [pid] = repos.proposals.insertMany(run.id, [ach({ experienceId: "sumiu" })]);
    const r = repos.proposals.review(run.id, [{ proposalId: pid as string, decision: "accept" }]);
    expect(r.skipped).toBe(1);
    expect(repos.facts.achievements.count()).toBe(total);
  });

  it("experiência repetida rejeitada (já está no perfil): a conquista dela vai para a experiência do perfil", () => {
    const { repos, ids, run } = setup();
    const acme = ids.experienceIds[0] as string;
    const [e, a] = repos.proposals.insertMany(run.id, [acmeAgain, ach({ experienceIndex: 0 })]);
    applyReconciliation(repos, run.id, NOW);
    expect(repos.proposals.listByRun(run.id)[0]).toMatchObject({
      match: "existing",
      matchTargetId: acme,
    });
    const r = repos.proposals.review(run.id, [
      { proposalId: e as string, decision: "reject" },
      { proposalId: a as string, decision: "accept" },
    ]);
    expect(r.skipped).toBe(0);
    expect(achievementsOf(repos, acme)).toContain("Liderou 7 pessoas");
  });

  it("o usuário escolhe outra experiência na revisão (editedData.experienceId)", () => {
    const { repos, ids, run } = setup();
    const beta = ids.experienceIds[1] as string;
    const [pid] = repos.proposals.insertMany(run.id, [ach({})]);
    repos.proposals.review(run.id, [
      { proposalId: pid as string, decision: "edit", editedData: { experienceId: beta } },
    ]);
    expect(achievementsOf(repos, beta)).toContain("Liderou 7 pessoas");
  });

  it("escolher a experiência nova desta ingestão (editedData.experienceIndex) troca a do perfil", () => {
    const { repos, ids, run } = setup();
    const acme = ids.experienceIds[0] as string;
    const fresh: FactProposal = {
      kind: "experience",
      confidence: 0.9,
      data: {
        company: "Zeta Bank",
        title: "Tech Lead",
        startDate: "2019-01",
        endDate: "2019-12",
        isCurrent: false,
        tech: [],
      },
    };
    const [e, a] = repos.proposals.insertMany(run.id, [fresh, ach({ experienceId: acme })]);
    repos.proposals.review(run.id, [
      { proposalId: e as string, decision: "accept" },
      { proposalId: a as string, decision: "edit", editedData: { experienceIndex: 0 } },
    ]);
    const zeta = repos.facts.experiences.list().find((x) => x.company === "Zeta Bank");
    expect(achievementsOf(repos, zeta?.id as string)).toEqual(["Liderou 7 pessoas"]);
    expect(achievementsOf(repos, acme)).not.toContain("Liderou 7 pessoas");
  });

  it("conciliação: conquista com experienceId e o mesmo texto de uma que já existe → existing", () => {
    const { repos, ids } = setup();
    const acme = ids.experienceIds[0] as string;
    const out = reconcileProposals(
      [
        {
          index: 0,
          proposal: ach({ experienceId: acme, text: "Liderou a migração para Kubernetes" }),
        },
        { index: 1, proposal: ach({ experienceId: acme }) },
      ],
      existingFacts(repos),
      NOW,
    );
    expect(out.map((r) => r.match)).toEqual(["existing", "new"]);
  });
});
