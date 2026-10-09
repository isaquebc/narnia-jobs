import { describe, expect, it } from "vitest";
import {
  AnalyzeRepoOutputSchema,
  BudgetSchema,
  CheckProposalsOutputSchema,
  ConflictSchema,
  CoverageSchema,
  EvidenceSchema,
  FileResponseSchema,
  GithubAuthStatusResponseSchema,
  GithubIngestionCreateRequestSchema,
  GithubMetricsSchema,
  GithubPreviewResponseSchema,
  INGEST_OUTPUT_JSON_SCHEMAS,
  IngestionDecisionRequestSchema,
  IngestionEstimateRequestSchema,
  IngestionResponseSchema,
  IngestionStatusSchema,
  NotificationSchema,
  NotificationsListResponseSchema,
  PickFilesOutputSchema,
  PlanUsageSchema,
  ProposalWithIdSchema,
  RepoAnalysisSchema,
  RepoDigestSchema,
  RepoSchema,
  ReviewRequestSchema,
  RunReportSchema,
  RunStatusSchema,
  SynthesizeRunOutputSchema,
  WsEventSchema,
} from "../src/index";

const NOW = "2026-10-09T12:00:00.000Z";
const metrics = {
  commits: 120,
  prsOpened: 10,
  prsMerged: 8,
  prsClosed: 1,
  reviewsApproved: 4,
  issuesOpened: 3,
  issuesClosed: 2,
};

describe("F03/M1 shared · execução de ingestão", () => {
  it("RunStatus estende os estados do F01 com confirmação, decisão, pausa e cancelamento", () => {
    for (const s of ["estimating", "queued", "running", "review", "done", "error"])
      expect(RunStatusSchema.safeParse(s).success).toBe(true);
    for (const s of ["awaiting_confirmation", "awaiting_decision", "paused", "cancelled"])
      expect(RunStatusSchema.safeParse(s).success).toBe(true);
    expect(RunStatusSchema.safeParse("waiting").success).toBe(false);
    expect(IngestionStatusSchema.options).toEqual(RunStatusSchema.options);
  });

  it("Budget exige tokens inteiros, unidade conhecida e fatia por repositório", () => {
    const ok = {
      amount: 50_000,
      unit: "thousand",
      depth: "balanced",
      perRepo: 4_000,
      reserve: { synthesis: 6_000, check: 2_000 },
    };
    expect(BudgetSchema.safeParse(ok).success).toBe(true);
    expect(BudgetSchema.safeParse({ ...ok, unit: "kg" }).success).toBe(false);
    expect(BudgetSchema.safeParse({ ...ok, amount: 1.5 }).success).toBe(false);
    expect(BudgetSchema.safeParse({ ...ok, unit: "window_pct" }).success).toBe(true);
  });

  it("PlanUsage aceita janelas nulas e utilização 0–100", () => {
    const usage = {
      subscription: "max",
      source: "usage_api",
      windows: {
        fiveHour: { utilization: 42, resetsAt: NOW },
        sevenDay: null,
        perModel: [{ model: "sonnet", utilization: 10, resetsAt: null }],
      },
    };
    expect(PlanUsageSchema.safeParse(usage).success).toBe(true);
    const bad = {
      ...usage,
      windows: { ...usage.windows, fiveHour: { utilization: 140, resetsAt: NOW } },
    };
    expect(PlanUsageSchema.safeParse(bad).success).toBe(false);
  });

  it("RunReport soma estimado × usado por repositório e lista paradas", () => {
    const report = {
      model: "haiku",
      budget: 50_000,
      totals: { estimated: 30_000, used: 32_000 },
      repos: [
        { fullName: "ana/api", estimatedTokens: 15_000, usedTokens: 16_000, status: "done" },
        {
          fullName: "ana/web",
          estimatedTokens: 15_000,
          usedTokens: 0,
          status: "skipped_budget",
          stoppedReason: "budget",
        },
      ],
      stops: [{ at: NOW, reason: "budget", usedTokens: 32_000 }],
      skipped: ["ana/web"],
      startedAt: NOW,
      finishedAt: null,
      synthesis: null,
    };
    expect(RunReportSchema.safeParse(report).success).toBe(true);
  });
});

describe("F03/M1 shared · GitHub", () => {
  it("Repo, métricas e análise com relatório e cobertura", () => {
    expect(
      RepoSchema.safeParse({
        id: "r1",
        fullName: "ana/api",
        owner: "ana",
        url: "https://github.com/ana/api",
        description: null,
        isPrivate: false,
        isFork: false,
        isArchived: false,
        languages: { TypeScript: 1200 },
        topics: ["api"],
        stars: 3,
        pushedAt: NOW,
        defaultBranch: "main",
        headSha: "abc123",
        relevance: 0.7,
        lastAnalysisId: null,
      }).success,
    ).toBe(true);
    expect(GithubMetricsSchema.safeParse(metrics).success).toBe(true);
    expect(GithubMetricsSchema.safeParse({ ...metrics, commits: -1 }).success).toBe(false);
    expect(CoverageSchema.safeParse({ files: ["src/index.ts"], topics: ["api"] }).success).toBe(
      true,
    );
    const analysis = {
      id: "a1",
      repoId: "r1",
      runId: "run1",
      parentId: null,
      headSha: "abc123",
      baseSha: null,
      depth: "deep",
      kind: "full",
      report: {
        summary: "API em Node",
        stack: ["Node"],
        highlights: [],
        risks: [],
        suggestedProjects: [],
      },
      coverage: { files: [], topics: [] },
      usage: { inputTokens: 100, outputTokens: 20 },
      status: "done",
      createdAt: NOW,
    };
    expect(RepoAnalysisSchema.safeParse(analysis).success).toBe(true);
    expect(RepoAnalysisSchema.safeParse({ ...analysis, kind: "rewrite" }).success).toBe(false);
  });

  it("digest de repositório tem o mesmo formato do digest de arquivo, com repoId (F03-11)", () => {
    const d = {
      repoId: "r1",
      summary: "Resumo",
      keyPoints: ["a"],
      sections: [],
      meta: {},
      editedByUser: false,
    };
    expect(RepoDigestSchema.safeParse(d).success).toBe(true);
    expect(RepoDigestSchema.safeParse({ ...d, repoId: "" }).success).toBe(false);
  });

  it("preview agrupa Pessoais e organizações; auth nunca expõe token", () => {
    const repo = {
      fullName: "ana/api",
      name: "api",
      owner: "ana",
      url: "https://github.com/ana/api",
      description: null,
      isPrivate: false,
      isFork: false,
      isArchived: false,
      language: "TypeScript",
      stars: 1,
      pushedAt: NOW,
      selected: true,
    };
    const preview = {
      mode: "public",
      authenticated: false,
      rateLimited: false,
      groups: [
        {
          key: "personal",
          kind: "personal",
          label: "Pessoais",
          total: 1,
          selected: 1,
          repos: [repo],
        },
      ],
    };
    expect(GithubPreviewResponseSchema.safeParse(preview).success).toBe(true);
    const auth = {
      source: "host",
      connected: true,
      login: "ana",
      scopes: ["repo"],
      hostAvailable: true,
    };
    expect(GithubAuthStatusResponseSchema.safeParse(auth).success).toBe(true);
    expect(GithubAuthStatusResponseSchema.parse({ ...auth, token: "ghp_x" })).not.toHaveProperty(
      "token",
    );
  });

  it("criação de ingestão do GitHub exige repositórios, modo, profundidade e modelo", () => {
    const body = {
      source: "github",
      mode: "private",
      repos: ["ana/api"],
      depth: "quick",
      model: "haiku",
    };
    expect(GithubIngestionCreateRequestSchema.safeParse(body).success).toBe(true);
    expect(GithubIngestionCreateRequestSchema.safeParse({ ...body, repos: [] }).success).toBe(
      false,
    );
    expect(
      GithubIngestionCreateRequestSchema.safeParse({
        ...body,
        budget: { amount: 20_000, unit: "thousand" },
      }).success,
    ).toBe(true);
    expect(
      IngestionEstimateRequestSchema.safeParse({ source: "cv", fileId: "f1", model: "haiku" })
        .success,
    ).toBe(true);
    expect(IngestionEstimateRequestSchema.safeParse(body).success).toBe(true);
    expect(
      IngestionDecisionRequestSchema.safeParse({ action: "continue", extraBudget: 10_000 }).success,
    ).toBe(true);
    expect(IngestionDecisionRequestSchema.safeParse({ action: "pause" }).success).toBe(false);
  });
});

describe("F03/M1 shared · revisão, evidência e notificações", () => {
  it("evidência exige ref e trecho curto não vazio", () => {
    expect(EvidenceSchema.safeParse({ ref: "README.md", quote: "API em Node" }).success).toBe(true);
    expect(EvidenceSchema.safeParse({ ref: "README.md", quote: "" }).success).toBe(false);
    expect(EvidenceSchema.safeParse({ ref: "x", quote: "a".repeat(601) }).success).toBe(false);
  });

  it("proposta na API carrega match, conflito, evidência e selo, todos opcionais (compatível com F01)", () => {
    const base = {
      id: "p1",
      proposal: { kind: "skill", confidence: 0.9, data: { name: "React", category: "framework" } },
      decision: "pending",
      origin: null,
    };
    expect(ProposalWithIdSchema.safeParse(base).success).toBe(true);
    const full = {
      ...base,
      match: "conflict",
      matchTargetId: "s1",
      conflict: {
        targetId: "s1",
        fields: [
          {
            field: "level",
            current: 3,
            proposed: 4,
            currentSource: "cv",
            proposedSource: "github",
          },
        ],
      },
      evidence: { ref: "package.json", quote: '"react": "^19"' },
      checkStatus: "supported",
      suggestedProfiles: ["prof1"],
    };
    expect(ProposalWithIdSchema.safeParse(full).success).toBe(true);
    expect(ConflictSchema.safeParse(full.conflict).success).toBe(true);
  });

  it("revisão aceita resolução por campo para conflitos (F03-6)", () => {
    const req = {
      decisions: [
        {
          proposalId: "p1",
          decision: "accepted",
          resolution: { level: { choice: "use_new" }, title: { choice: "edit", value: "Dev" } },
        },
      ],
    };
    expect(ReviewRequestSchema.safeParse(req).success).toBe(true);
    const bad = {
      decisions: [
        { proposalId: "p1", decision: "accepted", resolution: { level: { choice: "x" } } },
      ],
    };
    expect(ReviewRequestSchema.safeParse(bad).success).toBe(false);
  });

  it("notificação tem tipo conhecido, assunto, link e estados", () => {
    const n = {
      id: "n1",
      kind: "review.pending",
      subjectKind: "ingestion_run",
      subjectId: "run1",
      title: "Revisão pendente",
      body: null,
      actionUrl: "/ingestao/run1",
      severity: "info",
      createdAt: NOW,
      readAt: null,
      dismissedAt: null,
      resolvedAt: null,
    };
    expect(NotificationSchema.safeParse(n).success).toBe(true);
    expect(NotificationSchema.safeParse({ ...n, kind: "random" }).success).toBe(false);
    expect(
      NotificationsListResponseSchema.safeParse({ notifications: [n], unresolved: 1 }).success,
    ).toBe(true);
  });

  it("WS aceita ingestion.updated e notification.created/updated", () => {
    const n = {
      id: "n1",
      kind: "ingestion.done",
      subjectKind: "ingestion_run",
      subjectId: "run1",
      title: "Pronto",
      body: null,
      actionUrl: "/ingestao/run1",
      severity: "info",
      createdAt: NOW,
      readAt: null,
      dismissedAt: null,
      resolvedAt: null,
    };
    expect(
      WsEventSchema.safeParse({ type: "ingestion.updated", runId: "r", status: "paused" }).success,
    ).toBe(true);
    expect(WsEventSchema.safeParse({ type: "notification.created", notification: n }).success).toBe(
      true,
    );
    expect(WsEventSchema.safeParse({ type: "notification.updated", notification: n }).success).toBe(
      true,
    );
  });

  it("resposta de arquivo informa execuções anteriores (já lido) e a de ingestão aceita GitHub sem arquivo", () => {
    const file = {
      id: "f1",
      kind: "cv",
      originalName: "cv.pdf",
      mime: "application/pdf",
      size: 10,
      pages: 1,
      uploadedAt: NOW,
      previousRuns: [{ runId: "run0", status: "done", createdAt: NOW }],
    };
    expect(FileResponseSchema.safeParse(file).success).toBe(true);
    const { previousRuns: _p, ...f01 } = file;
    expect(FileResponseSchema.safeParse(f01).success).toBe(true);
    expect(
      IngestionResponseSchema.safeParse({
        id: "run1",
        fileId: null,
        source: "github",
        status: "awaiting_decision",
        jobs: [],
        proposals: [],
        digest: null,
        error: null,
      }).success,
    ).toBe(true);
  });
});

describe("F03/M1 shared · saídas estruturadas do modelo (JSON Schema)", () => {
  it("pickFiles limita a 8 arquivos", () => {
    const files = Array.from({ length: 9 }, (_, i) => ({ path: `f${i}.ts`, reason: "x" }));
    expect(PickFilesOutputSchema.safeParse({ files: files.slice(0, 8) }).success).toBe(true);
    expect(PickFilesOutputSchema.safeParse({ files }).success).toBe(false);
  });

  it("analyzeRepo devolve projetos e skills com evidência, relatório e cobertura", () => {
    const out = {
      projects: [
        {
          confidence: 0.9,
          name: "api",
          tech: ["Node"],
          evidence: { ref: "README.md", quote: "API em Node" },
        },
      ],
      skills: [
        {
          confidence: 0.8,
          name: "Node",
          category: "framework",
          evidence: { ref: "package.json", quote: "node" },
        },
      ],
      report: { summary: "s", stack: ["Node"], highlights: [], risks: [], suggestedProjects: [] },
      coverage: { files: ["README.md"], topics: ["api"] },
    };
    expect(AnalyzeRepoOutputSchema.safeParse(out).success).toBe(true);
    const noEvidence = {
      ...out,
      skills: [{ confidence: 0.8, name: "Node", category: "framework" }],
    };
    expect(AnalyzeRepoOutputSchema.safeParse(noEvidence).success).toBe(false);
  });

  it("synthesizeRun e checkProposals", () => {
    expect(
      SynthesizeRunOutputSchema.safeParse({
        skills: [],
        seniority: { level: "senior", rationale: "anos" },
        report: { summary: "s", highlights: [], gaps: [] },
      }).success,
    ).toBe(true);
    expect(
      CheckProposalsOutputSchema.safeParse({
        results: [{ proposalId: "p1", status: "partial", note: "x" }],
      }).success,
    ).toBe(true);
    expect(
      CheckProposalsOutputSchema.safeParse({ results: [{ proposalId: "p1", status: "unchecked" }] })
        .success,
    ).toBe(false);
  });

  it("JSON Schema das quatro saídas sem $schema e estável (snapshot)", () => {
    expect(Object.keys(INGEST_OUTPUT_JSON_SCHEMAS).sort()).toEqual([
      "analyzeRepo",
      "checkProposals",
      "pickFiles",
      "synthesizeRun",
    ]);
    for (const s of Object.values(INGEST_OUTPUT_JSON_SCHEMAS))
      expect(s).not.toHaveProperty("$schema");
    expect(INGEST_OUTPUT_JSON_SCHEMAS).toMatchSnapshot();
  });
});
