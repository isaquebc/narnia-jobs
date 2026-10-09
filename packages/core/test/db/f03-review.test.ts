import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, type Repos } from "../../src/db";
import { ProposalReviewError } from "../../src/db/repos/proposals";
import { applyReconciliation } from "../../src/ingest/reconcile";

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  const repos: Repos = createRepos(db);
  repos.users.ensureId();
  const file = repos.sourceFiles.insert({
    originalName: "cv2.pdf",
    mime: "application/pdf",
    size: 1,
    sha256: "sha-2",
    path: "uploads/sha-2.pdf",
    kind: "cv",
  });
  const run = repos.ingestionRuns.create({
    fileId: file.id,
    provider: "mock",
    models: { document: "h", facts: "h", digest: "s" },
    options: { ocr: false, modelRead: false },
  });
  return { repos, run };
}

describe("F03/M3 core · revisão com existentes, conflitos e projetos (§2.9-6)", () => {
  it("existente aceito liga a fonte nova sem duplicar o fato", () => {
    const { repos, run } = setup();
    const go = repos.facts.skills.insert({
      name: "Go",
      category: "language",
      confidence: 1,
      verified: true,
    });
    const [pid] = repos.proposals.insertMany(run.id, [
      { kind: "skill", confidence: 0.9, data: { name: "golang", category: "language" } },
    ]);
    applyReconciliation(repos, run.id);
    expect(repos.proposals.listByRun(run.id)[0]?.match).toBe("existing");
    const r = repos.proposals.review(run.id, [{ proposalId: pid as string, decision: "accept" }]);
    expect(r.accepted).toBe(1);
    expect(repos.facts.skills.list()).toHaveLength(1);
    expect(repos.proposals.listByRun(run.id)[0]?.targetId).toBe(go.id);
    const sources = repos.factSources.listForFact("skill", go.id);
    expect(sources.map((s) => s.runId)).toContain(run.id);
  });

  it("conflito sem resolução é recusado; com resolução aplica campo a campo e guarda a escolha", () => {
    const { repos, run } = setup();
    const exp = repos.facts.experiences.insert({
      company: "Acme Ltda",
      title: "Engenheira de Software",
      startDate: "2021-03",
      endDate: "2023-11",
      isCurrent: false,
      tech: [],
      confidence: 1,
      verified: true,
    });
    const [pid] = repos.proposals.insertMany(run.id, [
      {
        kind: "experience",
        confidence: 0.9,
        data: {
          company: "ACME",
          title: "Engenheira de Software Sênior",
          startDate: "2021-01",
          endDate: "2023-11",
          isCurrent: false,
          tech: [],
        },
      },
    ]);
    applyReconciliation(repos, run.id);
    const p = repos.proposals.listByRun(run.id)[0];
    expect(p?.match).toBe("conflict");
    const fields = p?.conflict?.fields.map((f) => f.field) ?? [];
    expect(fields).toEqual(expect.arrayContaining(["title", "startDate"]));
    expect(() =>
      repos.proposals.review(run.id, [{ proposalId: pid as string, decision: "accept" }]),
    ).toThrow(ProposalReviewError);
    try {
      repos.proposals.review(run.id, [{ proposalId: pid as string, decision: "accept" }]);
    } catch (e) {
      expect((e as ProposalReviewError).code).toBe("conflict_unresolved");
    }
    repos.proposals.review(run.id, [
      {
        proposalId: pid as string,
        decision: "accept",
        resolution: { title: { choice: "use_new" }, startDate: { choice: "keep" } },
      },
    ]);
    const after = repos.facts.experiences.get(exp.id);
    expect(after?.title).toBe("Engenheira de Software Sênior");
    expect(after?.startDate).toBe("2021-03");
    expect(repos.facts.experiences.list()).toHaveLength(1);
    expect(repos.proposals.listByRun(run.id)[0]?.resolution).toEqual({
      title: { choice: "use_new" },
      startDate: { choice: "keep" },
    });
  });

  it("projeto do GitHub aceito vira fato ligado ao repositório, com fonte do tipo github", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const repos = createRepos(db);
    repos.users.ensureId();
    const repo = repos.repos.upsert({
      fullName: "ana-exemplo/api-pagamentos",
      owner: "ana-exemplo",
      url: "https://github.com/ana-exemplo/api-pagamentos",
      description: null,
      isPrivate: false,
      isFork: false,
      isArchived: false,
      languages: {},
      topics: [],
      stars: 0,
      pushedAt: null,
      defaultBranch: "main",
      headSha: null,
      relevance: 0,
    });
    const run = repos.ingestionRuns.createGithub({
      provider: "mock",
      mode: "public",
      depth: "quick",
      model: "haiku",
      params: { repos: [repo.fullName] },
      budget: {
        amount: 1,
        unit: "thousand",
        depth: "quick",
        perRepo: 1,
        reserve: { synthesis: 0, check: 0 },
      },
    });
    const [pid] = repos.proposals.insertMany(run.id, [
      {
        kind: "project",
        confidence: 0.9,
        data: {
          name: "api-pagamentos",
          url: "https://github.com/ana-exemplo/api-pagamentos",
          tech: [],
        },
      },
    ]);
    const r = repos.proposals.review(run.id, [{ proposalId: pid as string, decision: "accept" }]);
    const project = repos.facts.projects.list()[0];
    expect(project?.repoId).toBe(repo.id);
    expect(repos.factSources.get(r.sourceId as string)?.kind).toBe("github");
  });
});
