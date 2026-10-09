import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common";
import { DigestMetaSchema, DigestSectionSchema } from "./file-digest";
import { IngestionDepthSchema } from "./ingest";

/** GitHub na F03 (§2.2–§2.7): repositórios, métricas, análises com relatório e cobertura, digest. */

export const RepoSchema = z.object({
  id: IdSchema,
  fullName: z.string().min(3),
  owner: z.string().min(1),
  url: z.url(),
  description: z.string().nullable(),
  isPrivate: z.boolean(),
  isFork: z.boolean(),
  isArchived: z.boolean(),
  languages: z.record(z.string(), z.number().min(0)),
  topics: z.array(z.string()),
  stars: z.number().int().min(0),
  pushedAt: IsoDateTimeSchema.nullable(),
  defaultBranch: z.string().nullable(),
  headSha: z.string().nullable(),
  relevance: z.number().min(0).max(1).nullable(),
  lastAnalysisId: IdSchema.nullable(),
});
export type Repo = z.infer<typeof RepoSchema>;

const Count = z.number().int().min(0);

/** Métricas quantitativas (F03-3 §3), por repositório, por ano ou globais. */
export const GithubMetricsSchema = z.object({
  commits: Count,
  prsOpened: Count,
  prsMerged: Count,
  prsClosed: Count,
  reviewsApproved: Count,
  issuesOpened: Count,
  issuesClosed: Count,
  ossRepos: Count.optional(),
  externalContributions: Count.optional(),
});
export type GithubMetrics = z.infer<typeof GithubMetricsSchema>;
export const GithubMetricScopeSchema = z.enum(["repo", "year", "global"]);

/** Mapa de cobertura (F03-3 §7): o que a análise já leu, para a segunda rodada aprofundar ou cobrir o resto. */
export const CoverageSchema = z.object({ files: z.array(z.string()), topics: z.array(z.string()) });
export type Coverage = z.infer<typeof CoverageSchema>;

export const RepoReportSchema = z.object({
  summary: z.string().min(1),
  stack: z.array(z.string()),
  highlights: z.array(z.string()),
  risks: z.array(z.string()),
  suggestedProjects: z.array(z.string()),
});
export type RepoReport = z.infer<typeof RepoReportSchema>;

export const RepoAnalysisKindSchema = z.enum(["full", "incremental", "deepen", "cover"]);
export type RepoAnalysisKind = z.infer<typeof RepoAnalysisKindSchema>;
export const RepoAnalysisStatusSchema = z.enum(["running", "done", "skipped_budget", "error"]);
export type RepoAnalysisStatus = z.infer<typeof RepoAnalysisStatusSchema>;

export const RepoAnalysisSchema = z.object({
  id: IdSchema,
  repoId: IdSchema,
  runId: IdSchema.nullable(),
  parentId: IdSchema.nullable(),
  headSha: z.string().nullable(),
  baseSha: z.string().nullable(),
  depth: IngestionDepthSchema,
  kind: RepoAnalysisKindSchema,
  report: RepoReportSchema.nullable(),
  coverage: CoverageSchema,
  usage: z.object({ inputTokens: Count, outputTokens: Count }),
  status: RepoAnalysisStatusSchema,
  createdAt: IsoDateTimeSchema,
});
export type RepoAnalysis = z.infer<typeof RepoAnalysisSchema>;

/** Digest de repositório: mesmo formato do digest de arquivo, em tabela irmã (F03-11). */
export const RepoDigestSchema = z.object({
  repoId: IdSchema,
  summary: z.string().min(1),
  keyPoints: z.array(z.string().min(1)),
  sections: z.array(DigestSectionSchema),
  meta: DigestMetaSchema,
  editedByUser: z.boolean(),
});
export type RepoDigest = z.infer<typeof RepoDigestSchema>;

/** Item do seletor (F03-2): o que a tela precisa, sem gravar nada. */
export const RepoPreviewItemSchema = z.object({
  fullName: z.string().min(3),
  name: z.string().min(1),
  owner: z.string().min(1),
  url: z.url(),
  description: z.string().nullable(),
  isPrivate: z.boolean(),
  isFork: z.boolean(),
  isArchived: z.boolean(),
  language: z.string().nullable(),
  stars: Count,
  pushedAt: IsoDateTimeSchema.nullable(),
  selected: z.boolean(),
});
export type RepoPreviewItem = z.infer<typeof RepoPreviewItemSchema>;

export const RepoGroupSchema = z.object({
  key: z.string().min(1),
  kind: z.enum(["personal", "org"]),
  label: z.string().min(1),
  total: Count,
  selected: Count,
  repos: z.array(RepoPreviewItemSchema),
});
export type RepoGroup = z.infer<typeof RepoGroupSchema>;
