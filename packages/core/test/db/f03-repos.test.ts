import { describe, expect, it } from "vitest";
import { createRepos, migrate, openDatabase, type Repos } from "../../src/db";
import {
  DEFAULT_INGEST_SETTINGS,
  ingestModelsForDepth,
  resolveIngestSettings,
} from "../../src/ingest/settings";

function setup(): Repos {
  const db = openDatabase(":memory:");
  migrate(db);
  return createRepos(db);
}

const BUDGET = {
  amount: 50_000,
  unit: "thousand" as const,
  depth: "balanced" as const,
  perRepo: 4_000,
  reserve: { synthesis: 6_000, check: 2_000 },
};

function cvRun(r: Repos) {
  const file = r.sourceFiles.insert({
    originalName: "cv.pdf",
    mime: "application/pdf",
    size: 10,
    sha256: "sha-cv",
    path: "uploads/sha-cv.pdf",
    kind: "cv",
  });
  return r.ingestionRuns.create({
    fileId: file.id,
    provider: "mock",
    models: { document: "h", facts: "h", digest: "s" },
    options: { ocr: true, modelRead: true },
  });
}

describe("F03/M1 ingestionRuns estendido", () => {
  it("execução de CV ganha source pelo tipo do arquivo; GitHub nasce sem arquivo", () => {
    const r = setup();
    expect(cvRun(r).source).toBe("cv");
    const gh = r.ingestionRuns.createGithub({
      provider: "mock",
      mode: "private",
      depth: "balanced",
      model: "haiku",
      params: { repos: ["ana/api", "ana/web"] },
      budget: BUDGET,
    });
    expect(gh).toMatchObject({
      fileId: null,
      source: "github",
      mode: "private",
      depth: "balanced",
      model: "haiku",
      status: "estimating",
      params: { repos: ["ana/api", "ana/web"] },
      budget: BUDGET,
      report: null,
      parentRunId: null,
    });
  });

  it("estados novos; terminal marca finished_at; cancelled é terminal; paused não", () => {
    const r = setup();
    const gh = r.ingestionRuns.createGithub({
      provider: "mock",
      mode: "public",
      depth: "quick",
      model: "haiku",
      params: { repos: ["a/b"] },
      budget: BUDGET,
    });
    r.ingestionRuns.setStatus(gh.id, "awaiting_confirmation");
    expect(r.ingestionRuns.get(gh.id)?.finishedAt).toBeNull();
    r.ingestionRuns.setStatus(gh.id, "paused");
    expect(r.ingestionRuns.get(gh.id)?.finishedAt).toBeNull();
    r.ingestionRuns.setStatus(gh.id, "cancelled");
    expect(r.ingestionRuns.get(gh.id)?.finishedAt).toMatch(/Z$/);
  });

  it("relatório, orçamento, uso livre por chamada e soma do uso", () => {
    const r = setup();
    const gh = r.ingestionRuns.createGithub({
      provider: "mock",
      mode: "public",
      depth: "quick",
      model: "haiku",
      params: { repos: ["a/b"] },
      budget: BUDGET,
    });
    r.ingestionRuns.addUsage(gh.id, "repo:a/b", { inputTokens: 100, outputTokens: 20 });
    r.ingestionRuns.addUsage(gh.id, "synthesis", { inputTokens: 50, outputTokens: 10 });
    expect(r.ingestionRuns.usedTokens(gh.id)).toBe(180);
    r.ingestionRuns.setBudget(gh.id, { ...BUDGET, amount: 60_000 });
    expect(r.ingestionRuns.get(gh.id)?.budget?.amount).toBe(60_000);
    const report = {
      model: "haiku",
      budget: 60_000,
      totals: { estimated: 1, used: 180 },
      repos: [],
      stops: [],
      skipped: [],
      startedAt: null,
      finishedAt: null,
      synthesis: null,
    };
    r.ingestionRuns.setReport(gh.id, report);
    expect(r.ingestionRuns.get(gh.id)?.report).toEqual(report);
  });

  it("lista por estado (pendências) e execução filha de retomada", () => {
    const r = setup();
    const a = r.ingestionRuns.createGithub({
      provider: "mock",
      mode: "public",
      depth: "quick",
      model: "haiku",
      params: { repos: ["a/b"] },
      budget: BUDGET,
    });
    const b = r.ingestionRuns.createGithub({
      provider: "mock",
      mode: "public",
      depth: "quick",
      model: "haiku",
      params: { repos: ["a/b"] },
      budget: BUDGET,
      parentRunId: a.id,
    });
    r.ingestionRuns.setStatus(a.id, "paused");
    expect(
      r.ingestionRuns.list({ status: ["paused", "awaiting_decision"] }).map((x) => x.id),
    ).toEqual([a.id]);
    expect(r.ingestionRuns.list().length).toBe(2);
    expect(r.ingestionRuns.get(b.id)?.parentRunId).toBe(a.id);
  });
});

describe("F03/M1 proposals: reconciliação, evidência e selo", () => {
  it("insertMany com evidência; setMatch, setCheckStatus, setSuggestedProfiles, setResolution", () => {
    const r = setup();
    const run = cvRun(r);
    const [id] = r.proposals.insertMany(
      run.id,
      [{ kind: "skill", confidence: 0.9, data: { name: "React", category: "framework" } }],
      [{ ref: "cv", quote: "React" }],
    );
    const pid = id as string;
    let p = r.proposals.listByRun(run.id)[0];
    expect(p).toMatchObject({
      match: "new",
      checkStatus: "unchecked",
      evidence: { ref: "cv", quote: "React" },
    });
    const conflict = {
      targetId: "s1",
      fields: [
        { field: "level", current: 3, proposed: 4, currentSource: "cv", proposedSource: "github" },
      ],
    };
    r.proposals.setMatch(pid, { match: "conflict", targetId: "s1", conflict });
    r.proposals.setCheckStatus(pid, "partial");
    r.proposals.setSuggestedProfiles(pid, ["prof1"]);
    r.proposals.setResolution(pid, { level: { choice: "use_new" } });
    p = r.proposals.listByRun(run.id)[0];
    expect(p).toMatchObject({
      match: "conflict",
      matchTargetId: "s1",
      conflict,
      checkStatus: "partial",
      suggestedProfiles: ["prof1"],
      resolution: { level: { choice: "use_new" } },
    });
  });

  it("sem evidência a proposta fica com evidence nulo (F01 continua funcionando)", () => {
    const r = setup();
    const run = cvRun(r);
    r.proposals.insertMany(run.id, [
      { kind: "skill", confidence: 0.9, data: { name: "Go", category: "language" } },
    ]);
    expect(r.proposals.listByRun(run.id)[0]?.evidence).toBeNull();
  });
});

describe("F03/M1 repos GitHub", () => {
  const META = {
    fullName: "ana/api",
    owner: "ana",
    url: "https://github.com/ana/api",
    description: "API",
    isPrivate: false,
    isFork: false,
    isArchived: false,
    languages: { TypeScript: 100 },
    topics: ["api"],
    stars: 2,
    pushedAt: "2026-10-01T00:00:00.000Z",
    defaultBranch: "main",
    headSha: "aaa",
    relevance: 0.5,
  };

  it("repos.upsert por fullName mantém o id e atualiza metadados", () => {
    const r = setup();
    const a = r.repos.upsert(META);
    const b = r.repos.upsert({ ...META, stars: 5, headSha: "bbb" });
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ stars: 5, headSha: "bbb", lastAnalysisId: null });
    expect(r.repos.getByFullName("ana/api")?.id).toBe(a.id);
    expect(r.repos.list().length).toBe(1);
  });

  it("repoAnalyses: cria em execução, conclui com relatório e cobertura; última concluída por repositório", () => {
    const r = setup();
    const repo = r.repos.upsert(META);
    const a1 = r.repoAnalyses.create({
      repoId: repo.id,
      runId: null,
      depth: "quick",
      kind: "full",
      headSha: "aaa",
    });
    expect(a1).toMatchObject({
      status: "running",
      report: null,
      coverage: { files: [], topics: [] },
    });
    const report = {
      summary: "API",
      stack: ["Node"],
      highlights: [],
      risks: [],
      suggestedProjects: [],
    };
    r.repoAnalyses.complete(a1.id, {
      status: "done",
      report,
      coverage: { files: ["README.md"], topics: ["api"] },
      usage: { inputTokens: 10, outputTokens: 2 },
    });
    const a2 = r.repoAnalyses.create({
      repoId: repo.id,
      runId: null,
      depth: "deep",
      kind: "deepen",
      headSha: "aaa",
      parentId: a1.id,
    });
    expect(r.repoAnalyses.latestDone(repo.id)?.id).toBe(a1.id);
    expect(r.repoAnalyses.listByRepo(repo.id).map((a) => a.id)).toEqual([a2.id, a1.id]);
    expect(r.repos.get(repo.id)?.lastAnalysisId).toBe(a1.id);
    expect(r.repoAnalyses.get(a1.id)?.report).toEqual(report);
  });

  it("repoDigests preserva a edição do usuário como o digest de arquivo", () => {
    const r = setup();
    const repo = r.repos.upsert(META);
    const base = { repoId: repo.id, keyPoints: ["a"], sections: [], meta: {} };
    r.repoDigests.upsert({ ...base, summary: "do modelo", editedByUser: false });
    r.repoDigests.upsert({ ...base, summary: "do usuário", editedByUser: true });
    r.repoDigests.upsert({ ...base, summary: "nova análise", editedByUser: false });
    expect(r.repoDigests.get(repo.id)?.summary).toBe("do usuário");
  });

  it("githubMetrics: uma linha por escopo (repositório, ano, global), substituída a cada coleta", () => {
    const r = setup();
    const repo = r.repos.upsert(META);
    const m = {
      commits: 1,
      prsOpened: 0,
      prsMerged: 0,
      prsClosed: 0,
      reviewsApproved: 0,
      issuesOpened: 0,
      issuesClosed: 0,
    };
    r.githubMetrics.put({ scope: "repo", repoId: repo.id }, m);
    r.githubMetrics.put({ scope: "repo", repoId: repo.id }, { ...m, commits: 7 });
    r.githubMetrics.put({ scope: "year", year: 2025 }, m);
    r.githubMetrics.put({ scope: "global" }, { ...m, ossRepos: 3 });
    expect(r.githubMetrics.get({ scope: "repo", repoId: repo.id })?.commits).toBe(7);
    expect(r.githubMetrics.get({ scope: "global" })?.ossRepos).toBe(3);
    expect(r.githubMetrics.list().length).toBe(3);
  });

  it("snapshots: total, LRU pelo último uso e remoção", () => {
    const r = setup();
    const s1 = r.snapshots.create({
      source: "github",
      ref: "ana/api",
      headSha: "a",
      path: "p1",
      sha256: "x",
      size: 100,
    });
    const s2 = r.snapshots.create({
      source: "github",
      ref: "ana/web",
      headSha: "b",
      path: "p2",
      sha256: "y",
      size: 50,
    });
    r.snapshots.touch(s1.id);
    expect(r.snapshots.totalBytes()).toBe(150);
    expect(r.snapshots.lru().map((s) => s.id)).toEqual([s2.id, s1.id]);
    r.snapshots.remove(s2.id);
    expect(r.snapshots.list().map((s) => s.id)).toEqual([s1.id]);
  });

  it("fact_source liga repositório e análise; projeto guarda repoId", () => {
    const r = setup();
    const repo = r.repos.upsert(META);
    const an = r.repoAnalyses.create({
      repoId: repo.id,
      runId: null,
      depth: "quick",
      kind: "full",
      headSha: "a",
    });
    const fs = r.factSources.create({
      kind: "github",
      repoId: repo.id,
      analysisId: an.id,
      url: META.url,
    });
    expect(fs).toMatchObject({ repoId: repo.id, analysisId: an.id });
    r.users.ensureId();
    const p = r.facts.projects.insert({
      name: "api",
      tech: [],
      repoId: repo.id,
      confidence: 1,
      verified: true,
    });
    expect(r.facts.projects.get(p.id)?.repoId).toBe(repo.id);
  });
});

describe("F03/M1 notifications (F03-10)", () => {
  const N = {
    kind: "review.pending" as const,
    subjectKind: "ingestion_run",
    subjectId: "run1",
    title: "Revisão pendente",
    actionUrl: "/ingestao/run1",
  };

  it("upsert não duplica pendência aberta do mesmo assunto; atualiza título", () => {
    const r = setup();
    const a = r.notifications.upsert(N);
    const b = r.notifications.upsert({ ...N, title: "Revisão pendente (16 propostas)" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.notification.id).toBe(a.notification.id);
    expect(b.notification.title).toBe("Revisão pendente (16 propostas)");
    expect(r.notifications.countUnresolved()).toBe(1);
  });

  it("resolve pelo assunto (o fluxo resolve, não o clique); depois disso um upsert cria outra", () => {
    const r = setup();
    r.notifications.upsert(N);
    r.notifications.upsert({ ...N, kind: "review.conflicts", title: "Conflitos" });
    const resolved = r.notifications.resolveSubject("ingestion_run", "run1", ["review.pending"]);
    expect(resolved.map((n) => n.kind)).toEqual(["review.pending"]);
    expect(r.notifications.countUnresolved()).toBe(1);
    expect(r.notifications.upsert(N).created).toBe(true);
  });

  it("ler marca readAt; dispensar esconde da lista aberta sem resolver", () => {
    const r = setup();
    const { notification } = r.notifications.upsert(N);
    r.notifications.markRead(notification.id);
    expect(r.notifications.get(notification.id)?.readAt).toMatch(/Z$/);
    r.notifications.dismiss(notification.id);
    expect(r.notifications.list({ status: "open" })).toEqual([]);
    expect(r.notifications.get(notification.id)?.resolvedAt).toBeNull();
    expect(r.notifications.countUnresolved()).toBe(0);
    expect(r.notifications.list({ status: "all" }).length).toBe(1);
  });

  it("lista resolvidas e abertas em ordem do mais novo", () => {
    const r = setup();
    r.notifications.upsert(N);
    r.notifications.upsert({ ...N, subjectId: "run2", actionUrl: "/ingestao/run2" });
    r.notifications.resolveSubject("ingestion_run", "run1");
    expect(r.notifications.list({ status: "resolved" }).map((n) => n.subjectId)).toEqual(["run1"]);
    expect(r.notifications.list({ status: "open" }).map((n) => n.subjectId)).toEqual(["run2"]);
  });
});

describe("F03/M1 settings da ingestão", () => {
  it("padrões do plano e override por chave", () => {
    const r = setup();
    expect(resolveIngestSettings(r.settings)).toEqual(DEFAULT_INGEST_SETTINGS);
    expect(DEFAULT_INGEST_SETTINGS).toMatchObject({
      githubAuth: "host",
      budgetDefaults: { quick: 15_000, balanced: 50_000, deep: 150_000 },
      budgetUnit: "thousand",
      reviewCheckModelEnabled: true,
      autoConfirmBelow: 10_000,
      snapshotsMaxBytes: 2 * 1024 ** 3,
    });
    r.settings.set("ingest.auto_confirm_below", 0);
    r.settings.set("github.auth", "app");
    expect(resolveIngestSettings(r.settings)).toMatchObject({
      autoConfirmBelow: 0,
      githubAuth: "app",
    });
  });

  it("modelos por profundidade (F03-5): profunda usa sonnet na síntese; escolha e revisor no mais barato", () => {
    const r = setup();
    expect(ingestModelsForDepth(r.settings, "quick")).toEqual({
      pick: "haiku",
      repo: "haiku",
      synthesis: "haiku",
      check: "haiku",
    });
    expect(ingestModelsForDepth(r.settings, "deep").synthesis).toBe("sonnet");
    expect(ingestModelsForDepth(r.settings, "deep", "opus")).toMatchObject({
      repo: "opus",
      synthesis: "opus",
      pick: "haiku",
    });
  });
});
