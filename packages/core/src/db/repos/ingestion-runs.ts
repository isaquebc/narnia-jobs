import { nowUtc } from "@narnia-jobs/shared";
import { newId } from "../../ids";
import type { Db } from "../open";
import { json, type Row, str } from "../sql";

export type RunStatus = "estimating" | "queued" | "running" | "review" | "done" | "error";
export interface RunModels {
  document: string;
  facts: string;
  digest: string;
}
export interface RunOptions {
  ocr: boolean;
  modelRead: boolean;
}
export interface RunEstimate {
  documentTokens: number;
  factsTokens: number;
  digestTokens: number;
}
export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  cacheRead?: number;
  cacheWrite?: number;
}
export type RunUsage = Partial<Record<"document" | "facts" | "digest", CallUsage>>;

export interface IngestionRunRecord {
  id: string;
  fileId: string;
  provider: string;
  models: RunModels;
  options: RunOptions;
  depth: string;
  status: RunStatus;
  estimate: RunEstimate | null;
  usage: RunUsage | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
export interface RunCreate {
  fileId: string;
  provider: string;
  models: RunModels;
  options: RunOptions;
  depth?: string;
}

export interface IngestionRunsRepo {
  create(input: RunCreate): IngestionRunRecord;
  get(id: string): IngestionRunRecord | null;
  listByFile(fileId: string): IngestionRunRecord[];
  setEstimate(id: string, estimate: RunEstimate): void;
  setStatus(id: string, status: RunStatus, patch?: { error?: string | null }): void;
  addUsage(id: string, call: keyof RunUsage, usage: CallUsage): void;
}

function map(r: Row): IngestionRunRecord {
  return {
    id: String(r.id),
    fileId: String(r.file_id),
    provider: String(r.provider),
    models: json<RunModels>(r.models_json, { document: "", facts: "", digest: "" }),
    options: json<RunOptions>(r.options_json, { ocr: true, modelRead: true }),
    depth: String(r.depth),
    status: String(r.status) as RunStatus,
    estimate: json<RunEstimate | null>(r.estimate_json, null),
    usage: json<RunUsage | null>(r.usage_json, null),
    error: str(r.error),
    createdAt: String(r.created_at),
    startedAt: str(r.started_at),
    finishedAt: str(r.finished_at),
  };
}

export function ingestionRunsRepo(db: Db): IngestionRunsRepo {
  const insert = db.prepare(
    "insert into ingestion_run (id, file_id, provider, models_json, options_json, depth, status, created_at) values (?, ?, ?, ?, ?, ?, 'estimating', ?)",
  );
  const get = db.prepare("select * from ingestion_run where id = ?");
  const byFile = db.prepare(
    "select * from ingestion_run where file_id = ? order by created_at desc",
  );
  const setEst = db.prepare("update ingestion_run set estimate_json = ? where id = ?");
  const setStatus = db.prepare(
    "update ingestion_run set status = ?, error = ?, started_at = coalesce(started_at, ?), finished_at = ? where id = ?",
  );
  const setUsage = db.prepare("update ingestion_run set usage_json = ? where id = ?");
  const repo: IngestionRunsRepo = {
    create(input) {
      const id = newId();
      insert.run(
        id,
        input.fileId,
        input.provider,
        JSON.stringify(input.models),
        JSON.stringify(input.options),
        input.depth ?? "quick",
        nowUtc(),
      );
      return map(get.get(id) as Row);
    },
    get(id) {
      const row = get.get(id) as Row | undefined;
      return row ? map(row) : null;
    },
    listByFile(fileId) {
      return (byFile.all(fileId) as Row[]).map(map);
    },
    setEstimate(id, estimate) {
      setEst.run(JSON.stringify(estimate), id);
    },
    setStatus(id, status, patch) {
      const now = nowUtc();
      const terminal = status === "review" || status === "done" || status === "error";
      const startedMarker = status === "running" ? now : null;
      setStatus.run(status, patch?.error ?? null, startedMarker, terminal ? now : null, id);
    },
    addUsage(id, call, usage) {
      const current = repo.get(id);
      if (!current) throw new Error(`Run não encontrado: ${id}`);
      const next: RunUsage = { ...(current.usage ?? {}), [call]: usage };
      setUsage.run(JSON.stringify(next), id);
    },
  };
  return repo;
}
