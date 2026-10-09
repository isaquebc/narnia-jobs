import {
  type Coverage,
  type GithubMetrics,
  GithubMetricsSchema,
  type IngestionDepth,
  nowUtc,
  type Repo,
  type RepoAnalysis,
  type RepoAnalysisKind,
  type RepoAnalysisStatus,
  type RepoDigest,
  RepoDigestSchema,
  type RepoReport,
} from "@narnia-jobs/shared";
import { newId } from "../../ids";
import type { Db } from "../open";
import { bool, json, num, type Row, str } from "../sql";

/** Repositórios do GitHub, análises, digest e métricas (F03 §3). Nada aqui guarda credencial. */

export type RepoInput = Omit<Repo, "id" | "lastAnalysisId">;

export interface ReposRepo {
  /** Insere ou atualiza pelo `fullName`, mantendo o id e a última análise. */
  upsert(input: RepoInput): Repo;
  get(id: string): Repo | null;
  getByFullName(fullName: string): Repo | null;
  list(): Repo[];
}

function mapRepo(r: Row): Repo {
  return {
    id: String(r.id),
    fullName: String(r.full_name),
    owner: String(r.owner),
    url: String(r.url),
    description: str(r.description),
    isPrivate: bool(r.is_private),
    isFork: bool(r.is_fork),
    isArchived: bool(r.is_archived),
    languages: json<Record<string, number>>(r.languages_json, {}),
    topics: json<string[]>(r.topics_json, []),
    stars: Number(r.stars),
    pushedAt: str(r.pushed_at),
    defaultBranch: str(r.default_branch),
    headSha: str(r.head_sha),
    relevance: num(r.relevance),
    lastAnalysisId: str(r.last_analysis_id),
  };
}

export function reposRepo(db: Db): ReposRepo {
  const upsert = db.prepare(
    `insert into repo (id, full_name, owner, url, description, is_private, is_fork, is_archived, languages_json,
       topics_json, stars, pushed_at, default_branch, head_sha, relevance, created_at, updated_at)
     values (@id, @full_name, @owner, @url, @description, @is_private, @is_fork, @is_archived, @languages_json,
       @topics_json, @stars, @pushed_at, @default_branch, @head_sha, @relevance, @now, @now)
     on conflict (full_name) do update set owner = excluded.owner, url = excluded.url,
       description = excluded.description, is_private = excluded.is_private, is_fork = excluded.is_fork,
       is_archived = excluded.is_archived, languages_json = excluded.languages_json, topics_json = excluded.topics_json,
       stars = excluded.stars, pushed_at = excluded.pushed_at, default_branch = excluded.default_branch,
       head_sha = excluded.head_sha, relevance = excluded.relevance, updated_at = excluded.updated_at`,
  );
  const get = db.prepare("select * from repo where id = ?");
  const byName = db.prepare("select * from repo where full_name = ?");
  const all = db.prepare("select * from repo order by pushed_at desc, full_name");
  const repo: ReposRepo = {
    upsert(i) {
      upsert.run({
        id: newId(),
        full_name: i.fullName,
        owner: i.owner,
        url: i.url,
        description: i.description,
        is_private: i.isPrivate ? 1 : 0,
        is_fork: i.isFork ? 1 : 0,
        is_archived: i.isArchived ? 1 : 0,
        languages_json: JSON.stringify(i.languages),
        topics_json: JSON.stringify(i.topics),
        stars: i.stars,
        pushed_at: i.pushedAt,
        default_branch: i.defaultBranch,
        head_sha: i.headSha,
        relevance: i.relevance,
        now: nowUtc(),
      });
      return repo.getByFullName(i.fullName) as Repo;
    },
    get(id) {
      const row = get.get(id) as Row | undefined;
      return row ? mapRepo(row) : null;
    },
    getByFullName(fullName) {
      const row = byName.get(fullName) as Row | undefined;
      return row ? mapRepo(row) : null;
    },
    list() {
      return (all.all() as Row[]).map(mapRepo);
    },
  };
  return repo;
}

export interface RepoAnalysisCreate {
  repoId: string;
  runId: string | null;
  depth: IngestionDepth;
  kind: RepoAnalysisKind;
  headSha: string | null;
  baseSha?: string | null;
  parentId?: string | null;
}
export interface RepoAnalysisCompletion {
  status: Exclude<RepoAnalysisStatus, "running">;
  report?: RepoReport | null;
  coverage?: Coverage;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface RepoAnalysesRepo {
  create(input: RepoAnalysisCreate): RepoAnalysis;
  /** Conclui a análise; quando `done`, vira a última análise do repositório. */
  complete(id: string, input: RepoAnalysisCompletion): RepoAnalysis;
  get(id: string): RepoAnalysis | null;
  /** Mais novas primeiro. */
  listByRepo(repoId: string): RepoAnalysis[];
  listByRun(runId: string): RepoAnalysis[];
  /** Última análise concluída: base da incremental e da segunda rodada (F03-3 §7). */
  latestDone(repoId: string): RepoAnalysis | null;
}

const EMPTY_COVERAGE: Coverage = { files: [], topics: [] };

function mapAnalysis(r: Row): RepoAnalysis {
  return {
    id: String(r.id),
    repoId: String(r.repo_id),
    runId: str(r.run_id),
    parentId: str(r.parent_id),
    headSha: str(r.head_sha),
    baseSha: str(r.base_sha),
    depth: String(r.depth) as IngestionDepth,
    kind: String(r.kind) as RepoAnalysisKind,
    report: json<RepoReport | null>(r.report_json, null),
    coverage: json<Coverage>(r.coverage_json, EMPTY_COVERAGE),
    usage: json(r.usage_json, { inputTokens: 0, outputTokens: 0 }),
    status: String(r.status) as RepoAnalysisStatus,
    createdAt: String(r.created_at),
  };
}

export function repoAnalysesRepo(db: Db): RepoAnalysesRepo {
  const insert = db.prepare(
    `insert into repo_analysis (id, repo_id, run_id, parent_id, head_sha, base_sha, depth, kind, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const get = db.prepare("select * from repo_analysis where id = ?");
  const byRepo = db.prepare(
    "select * from repo_analysis where repo_id = ? order by created_at desc, rowid desc",
  );
  const byRun = db.prepare(
    "select * from repo_analysis where run_id = ? order by created_at, rowid",
  );
  const latest = db.prepare(
    "select * from repo_analysis where repo_id = ? and status = 'done' order by created_at desc, rowid desc limit 1",
  );
  const finish = db.prepare(
    "update repo_analysis set status = ?, report_json = coalesce(?, report_json), coverage_json = coalesce(?, coverage_json), usage_json = coalesce(?, usage_json) where id = ?",
  );
  const setLast = db.prepare("update repo set last_analysis_id = ?, updated_at = ? where id = ?");
  const repo: RepoAnalysesRepo = {
    create(i) {
      const id = newId();
      insert.run(
        id,
        i.repoId,
        i.runId,
        i.parentId ?? null,
        i.headSha,
        i.baseSha ?? null,
        i.depth,
        i.kind,
        nowUtc(),
      );
      return repo.get(id) as RepoAnalysis;
    },
    complete(id, i) {
      const current = repo.get(id);
      if (!current) throw new Error(`Análise não encontrada: ${id}`);
      finish.run(
        i.status,
        i.report ? JSON.stringify(i.report) : null,
        i.coverage ? JSON.stringify(i.coverage) : null,
        i.usage ? JSON.stringify(i.usage) : null,
        id,
      );
      if (i.status === "done") setLast.run(id, nowUtc(), current.repoId);
      return repo.get(id) as RepoAnalysis;
    },
    get(id) {
      const row = get.get(id) as Row | undefined;
      return row ? mapAnalysis(row) : null;
    },
    listByRepo(repoId) {
      return (byRepo.all(repoId) as Row[]).map(mapAnalysis);
    },
    listByRun(runId) {
      return (byRun.all(runId) as Row[]).map(mapAnalysis);
    },
    latestDone(repoId) {
      const row = latest.get(repoId) as Row | undefined;
      return row ? mapAnalysis(row) : null;
    },
  };
  return repo;
}

export interface RepoDigestsRepo {
  /** Insere ou substitui; edição do usuário é preservada contra uma nova análise (como `file_digest`). */
  upsert(input: RepoDigest): RepoDigest & { updatedAt: string };
  get(repoId: string): (RepoDigest & { updatedAt: string }) | null;
}

export function repoDigestsRepo(db: Db): RepoDigestsRepo {
  const get = db.prepare("select * from repo_digest where repo_id = ?");
  const upsert = db.prepare(
    `insert into repo_digest (repo_id, summary, key_points_json, sections_json, meta_json, edited_by_user, updated_at)
     values (@repo_id, @summary, @key_points_json, @sections_json, @meta_json, @edited_by_user, @updated_at)
     on conflict (repo_id) do update set summary = excluded.summary, key_points_json = excluded.key_points_json,
       sections_json = excluded.sections_json, meta_json = excluded.meta_json, edited_by_user = excluded.edited_by_user,
       updated_at = excluded.updated_at`,
  );
  const map = (r: Row) => ({
    ...RepoDigestSchema.parse({
      repoId: String(r.repo_id),
      summary: String(r.summary),
      keyPoints: json(r.key_points_json, []),
      sections: json(r.sections_json, []),
      meta: json(r.meta_json, {}),
      editedByUser: bool(r.edited_by_user),
    }),
    updatedAt: String(r.updated_at),
  });
  const repo: RepoDigestsRepo = {
    upsert(input) {
      const valid = RepoDigestSchema.parse(input);
      const existing = repo.get(valid.repoId);
      const next =
        existing?.editedByUser && !valid.editedByUser
          ? {
              ...valid,
              summary: existing.summary,
              keyPoints: existing.keyPoints,
              sections: existing.sections,
              editedByUser: true,
            }
          : valid;
      upsert.run({
        repo_id: next.repoId,
        summary: next.summary,
        key_points_json: JSON.stringify(next.keyPoints),
        sections_json: JSON.stringify(next.sections),
        meta_json: JSON.stringify(next.meta),
        edited_by_user: next.editedByUser ? 1 : 0,
        updated_at: nowUtc(),
      });
      return repo.get(next.repoId) as RepoDigest & { updatedAt: string };
    },
    get(repoId) {
      const row = get.get(repoId) as Row | undefined;
      return row ? map(row) : null;
    },
  };
  return repo;
}

export type MetricScope =
  | { scope: "repo"; repoId: string }
  | { scope: "year"; year: number }
  | { scope: "global" };

export interface GithubMetricRecord {
  scope: MetricScope;
  metrics: GithubMetrics;
  collectedAt: string;
}

export interface GithubMetricsRepo {
  /** Substitui as métricas do escopo (uma linha por repositório, ano ou global). */
  put(scope: MetricScope, metrics: GithubMetrics): void;
  get(scope: MetricScope): GithubMetrics | null;
  list(): GithubMetricRecord[];
}

function scopeKey(s: MetricScope): string {
  if (s.scope === "repo") return `repo:${s.repoId}`;
  if (s.scope === "year") return `year:${s.year}`;
  return "global";
}

export function githubMetricsRepo(db: Db): GithubMetricsRepo {
  const put = db.prepare(
    `insert into github_metric (id, scope, scope_key, repo_id, year, metrics_json, collected_at)
     values (?, ?, ?, ?, ?, ?, ?)
     on conflict (scope_key) do update set metrics_json = excluded.metrics_json, collected_at = excluded.collected_at`,
  );
  const get = db.prepare("select metrics_json from github_metric where scope_key = ?");
  const all = db.prepare("select * from github_metric order by scope, scope_key");
  return {
    put(scope, metrics) {
      const valid = GithubMetricsSchema.parse(metrics);
      put.run(
        newId(),
        scope.scope,
        scopeKey(scope),
        scope.scope === "repo" ? scope.repoId : null,
        scope.scope === "year" ? scope.year : null,
        JSON.stringify(valid),
        nowUtc(),
      );
    },
    get(scope) {
      const row = get.get(scopeKey(scope)) as Row | undefined;
      return row ? json<GithubMetrics>(row.metrics_json, null as unknown as GithubMetrics) : null;
    },
    list() {
      return (all.all() as Row[]).map((r) => {
        const kind = String(r.scope);
        const scope: MetricScope =
          kind === "repo"
            ? { scope: "repo", repoId: String(r.repo_id) }
            : kind === "year"
              ? { scope: "year", year: Number(r.year) }
              : { scope: "global" };
        return {
          scope,
          metrics: json<GithubMetrics>(r.metrics_json, null as unknown as GithubMetrics),
          collectedAt: String(r.collected_at),
        };
      });
    },
  };
}
