/** Dados fictícios da F03 para os testes da web (mesmo usuário fictício "ana-exemplo" do core). */
import type { Notification } from "@narnia-jobs/shared";
import type { IngestionDetail, RepoDetail, RunSummary } from "../../src/lib/api";

export const T0 = "2026-10-09T12:00:00.000Z";

export function notification(partial: Partial<Notification> = {}): Notification {
  return {
    id: "n1",
    kind: "review.pending",
    subjectKind: "ingestion_run",
    subjectId: "r1",
    title: "Revisão pendente: GitHub (3 repositórios)",
    body: "14 propostas para revisar",
    actionUrl: "/ingestao/r1",
    severity: "info",
    createdAt: T0,
    readAt: null,
    dismissedAt: null,
    resolvedAt: null,
    ...partial,
  };
}

export function githubAuth(partial: Record<string, unknown> = {}) {
  return {
    source: "host" as const,
    connected: true,
    login: "ana-exemplo",
    scopes: ["repo", "read:org"],
    hostAvailable: true,
    ...partial,
  };
}

export function previewItem(name: string, partial: Record<string, unknown> = {}) {
  const owner = (partial.owner as string | undefined) ?? "ana-exemplo";
  return {
    fullName: `${owner}/${name}`,
    name,
    owner,
    url: `https://github.com/${owner}/${name}`,
    description: null,
    isPrivate: false,
    isFork: false,
    isArchived: false,
    language: "TypeScript",
    stars: 3,
    pushedAt: T0,
    selected: true,
    ...partial,
  };
}

export function preview(partial: Record<string, unknown> = {}) {
  return {
    mode: "private" as const,
    authenticated: true,
    rateLimited: false,
    groups: [
      {
        key: "personal",
        kind: "personal" as const,
        label: "ana-exemplo",
        total: 3,
        selected: 2,
        repos: [
          previewItem("api-pagamentos"),
          previewItem("dotfiles", { selected: true, isPrivate: true }),
          previewItem("fork-lib", { isFork: true, selected: false }),
        ],
      },
      {
        key: "org:acme-labs",
        kind: "org" as const,
        label: "acme-labs",
        total: 1,
        selected: 1,
        repos: [previewItem("plataforma", { owner: "acme-labs" })],
      },
    ],
    ...partial,
  };
}

export function planUsage() {
  return {
    usage: {
      subscription: "max",
      source: "usage_api" as const,
      windows: {
        fiveHour: { utilization: 35, resetsAt: "2026-10-09T15:00:00.000Z" },
        sevenDay: { utilization: 12, resetsAt: "2026-10-14T00:00:00.000Z" },
        perModel: [],
      },
    },
  };
}

export function ingestSettings(partial: Record<string, unknown> = {}) {
  return {
    githubAuth: "host" as const,
    budgetDefaults: { quick: 15_000, balanced: 50_000, deep: 150_000 },
    budgetUnit: "thousand" as const,
    reviewCheckModelEnabled: true,
    autoConfirmBelow: 10_000,
    snapshotsMaxBytes: 2 * 1024 ** 3,
    ...partial,
  };
}

export function estimate(partial: Record<string, unknown> = {}) {
  return {
    calls: [
      { name: "repo:ana-exemplo/api-pagamentos", model: "haiku", tokens: 4_000 },
      { name: "synthesis", model: "haiku", tokens: 1_500 },
    ],
    totalTokens: 15_100,
    recommendedBudget: 15_000,
    perRepo: 3_300,
    approximate: true,
    autoConfirm: false,
    ...partial,
  };
}

export function report(partial: Record<string, unknown> = {}) {
  return {
    model: "haiku",
    budget: 15_000,
    totals: { estimated: 15_100, used: 9_200 },
    repos: [
      {
        fullName: "ana-exemplo/api-pagamentos",
        estimatedTokens: 4_000,
        usedTokens: 4_400,
        status: "done" as const,
      },
      {
        fullName: "ana-exemplo/dotfiles",
        estimatedTokens: 4_000,
        usedTokens: 4_800,
        status: "done" as const,
      },
      {
        fullName: "acme-labs/plataforma",
        estimatedTokens: 4_000,
        usedTokens: 0,
        status: "pending" as const,
      },
    ],
    stops: [{ at: T0, reason: "budget", usedTokens: 9_200 }],
    skipped: [],
    startedAt: T0,
    finishedAt: null,
    synthesis: null,
    ...partial,
  };
}

export function budget() {
  return {
    amount: 15_000,
    unit: "thousand" as const,
    depth: "balanced" as const,
    perRepo: 3_300,
    reserve: { synthesis: 1_500, check: 600 },
  };
}

export function proposal(id: string, partial: Record<string, unknown> = {}) {
  return {
    id,
    proposal: {
      kind: "project",
      confidence: 0.9,
      data: { name: "api-pagamentos", tech: ["TypeScript", "Postgres"] },
    },
    decision: "pending" as const,
    origin: null,
    match: "new" as const,
    matchTargetId: null,
    conflict: null,
    evidence: { ref: "README.md", quote: "API de pagamentos com Postgres" },
    checkStatus: "supported" as const,
    suggestedProfiles: [],
    ...partial,
  };
}

export function run(partial: Record<string, unknown> = {}): IngestionDetail {
  return {
    id: "r1",
    fileId: null,
    source: "github" as const,
    mode: "private" as const,
    model: "haiku",
    depth: "balanced" as const,
    budget: budget(),
    report: report(),
    repos: ["ana-exemplo/api-pagamentos", "ana-exemplo/dotfiles", "acme-labs/plataforma"],
    analyses: [],
    parentRunId: null,
    status: "review" as const,
    jobs: [],
    proposals: [proposal("p1")],
    digest: null,
    error: null,
    ...partial,
  } as unknown as IngestionDetail;
}

export function runSummary(partial: Record<string, unknown> = {}): RunSummary {
  return {
    id: "r1",
    source: "github" as const,
    mode: "private" as const,
    status: "awaiting_decision" as const,
    fileId: null,
    model: "haiku",
    budget: budget(),
    report: report(),
    createdAt: T0,
    ...partial,
  } as RunSummary;
}

export function repo(partial: Record<string, unknown> = {}) {
  return {
    id: "rp1",
    fullName: "ana-exemplo/api-pagamentos",
    owner: "ana-exemplo",
    url: "https://github.com/ana-exemplo/api-pagamentos",
    description: "API de pagamentos",
    isPrivate: false,
    isFork: false,
    isArchived: false,
    languages: { TypeScript: 9000 },
    topics: ["payments"],
    stars: 3,
    pushedAt: T0,
    defaultBranch: "main",
    headSha: "abc1234def",
    relevance: 0.8,
    lastAnalysisId: "a1",
    ...partial,
  };
}

export function analysis(partial: Record<string, unknown> = {}) {
  return {
    id: "a1",
    repoId: "rp1",
    runId: "r1",
    parentId: null,
    headSha: "abc1234def",
    baseSha: null,
    depth: "balanced" as const,
    kind: "full" as const,
    report: {
      summary: "Serviço de pagamentos em TypeScript com testes de integração.",
      stack: ["TypeScript", "Postgres"],
      highlights: ["Idempotência nas cobranças"],
      risks: ["Sem CI configurado"],
      suggestedProjects: ["Publicar um SDK open source do cliente"],
    },
    coverage: { files: ["README.md", "src/server.ts"], topics: ["pagamentos"] },
    usage: { inputTokens: 3_000, outputTokens: 900 },
    status: "done" as const,
    createdAt: T0,
    ...partial,
  };
}

export function metrics() {
  return {
    commits: 120,
    prsOpened: 30,
    prsMerged: 25,
    prsClosed: 3,
    reviewsApproved: 14,
    issuesOpened: 8,
    issuesClosed: 6,
  };
}

export function repoDetail(partial: Partial<RepoDetail> = {}): RepoDetail {
  return {
    repo: repo() as RepoDetail["repo"],
    analyses: [analysis() as RepoDetail["analyses"][number]],
    digest: {
      repoId: "rp1",
      summary: "API de pagamentos com cobranças idempotentes.",
      keyPoints: ["TypeScript", "Postgres"],
      sections: [],
      meta: { language: "pt", chars: 1200 },
      editedByUser: false,
    } as unknown as RepoDetail["digest"],
    metrics: metrics(),
    ...partial,
  };
}
