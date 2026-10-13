import type {
  Budget,
  IngestionDepth,
  IngestionMode,
  IngestionSource,
  RunReport,
  RunStatus as SharedRunStatus,
} from "@narnia-jobs/shared";
import { nowUtc } from "@narnia-jobs/shared";
import { newId } from "../../ids";
import type { Db } from "../open";
import { json, type Row, str } from "../sql";

/** Estados do F01 + F03 (confirmação, decisão no freio, pausa, cancelamento). */
export type RunStatus = SharedRunStatus;
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
/** Uso real por chamada nomeada: `document`/`facts`/`digest` (F01) ou livre na F03 (`repo:<nome>`, `synthesis`…). */
export type RunUsage = Partial<Record<string, CallUsage>>;

/** Parâmetros da execução do GitHub (repositórios escolhidos, filtros). */
export interface RunParams {
  repos?: string[];
  [key: string]: unknown;
}

export interface IngestionRunRecord {
  id: string;
  /** Nulo para o GitHub (F03 §2.9-2). */
  fileId: string | null;
  source: IngestionSource;
  mode: IngestionMode | null;
  provider: string;
  models: RunModels;
  options: RunOptions;
  depth: string;
  status: RunStatus;
  estimate: RunEstimate | null;
  usage: RunUsage | null;
  error: string | null;
  params: RunParams;
  budget: Budget | null;
  model: string | null;
  report: RunReport | null;
  parentRunId: string | null;
  /** Conversa que abriu a execução (tool de ingestão do chat); recebe o aviso do fim. */
  chatSessionId: string | null;
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
  model?: string | null;
}
export interface GithubRunCreate {
  provider: string;
  mode: IngestionMode;
  depth: IngestionDepth;
  model: string;
  params: RunParams;
  budget: Budget;
  parentRunId?: string | null;
}

export interface IngestionRunsRepo {
  /** CV/texto (F01): `source` vem do tipo do arquivo. */
  create(input: RunCreate): IngestionRunRecord;
  createGithub(input: GithubRunCreate): IngestionRunRecord;
  get(id: string): IngestionRunRecord | null;
  listByFile(fileId: string): IngestionRunRecord[];
  /** Mais novas primeiro; `status` filtra (pendências: `paused`, `awaiting_decision`…). */
  list(filter?: { status?: RunStatus[]; source?: IngestionSource }): IngestionRunRecord[];
  /** Reanálises criadas a partir desta execução (`parent_run_id`), mais antigas primeiro. */
  listChildren(parentId: string): IngestionRunRecord[];
  setEstimate(id: string, estimate: RunEstimate): void;
  setStatus(id: string, status: RunStatus, patch?: { error?: string | null }): void;
  addUsage(id: string, call: string, usage: CallUsage): void;
  /** Soma de entrada + saída de todas as chamadas (freio do orçamento, F03-3 §6). */
  usedTokens(id: string): number;
  setBudget(id: string, budget: Budget): void;
  setReport(id: string, report: RunReport): void;
  /** Parâmetros da execução (repositórios, login, tabela de métricas, plano antes da execução…). */
  setParams(id: string, params: RunParams): void;
  /** Liga a execução à conversa que a abriu. */
  linkChat(id: string, sessionId: string): void;
  /** Marca o aviso do fim para a conversa; true só na primeira vez (o aviso sai uma vez). */
  claimChatNotice(id: string): boolean;
}

const TERMINAL: ReadonlySet<RunStatus> = new Set(["review", "done", "error", "cancelled"]);

function map(r: Row): IngestionRunRecord {
  return {
    id: String(r.id),
    fileId: str(r.file_id),
    source: String(r.source) as IngestionSource,
    mode: str(r.mode) as IngestionMode | null,
    provider: String(r.provider),
    models: json<RunModels>(r.models_json, { document: "", facts: "", digest: "" }),
    options: json<RunOptions>(r.options_json, { ocr: true, modelRead: true }),
    depth: String(r.depth),
    status: String(r.status) as RunStatus,
    estimate: json<RunEstimate | null>(r.estimate_json, null),
    usage: json<RunUsage | null>(r.usage_json, null),
    error: str(r.error),
    params: json<RunParams>(r.params_json, {}),
    budget: json<Budget | null>(r.budget_json, null),
    model: str(r.model),
    report: json<RunReport | null>(r.report_json, null),
    parentRunId: str(r.parent_run_id),
    chatSessionId: str(r.chat_session_id),
    createdAt: String(r.created_at),
    startedAt: str(r.started_at),
    finishedAt: str(r.finished_at),
  };
}

export function ingestionRunsRepo(db: Db): IngestionRunsRepo {
  const insert = db.prepare(
    `insert into ingestion_run (id, file_id, source, provider, models_json, options_json, depth, model, status, created_at)
     values (?, ?, coalesce((select kind from source_file where id = ?), 'cv'), ?, ?, ?, ?, ?, 'estimating', ?)`,
  );
  const insertGithub = db.prepare(
    `insert into ingestion_run (id, file_id, source, mode, provider, models_json, options_json, depth, model,
       params_json, budget_json, parent_run_id, status, created_at)
     values (?, null, 'github', ?, ?, '{}', '{}', ?, ?, ?, ?, ?, 'estimating', ?)`,
  );
  const get = db.prepare("select * from ingestion_run where id = ?");
  const byFile = db.prepare(
    "select * from ingestion_run where file_id = ? order by created_at desc, rowid desc",
  );
  const all = db.prepare("select * from ingestion_run order by created_at desc, rowid desc");
  const setEst = db.prepare("update ingestion_run set estimate_json = ? where id = ?");
  const setStatus = db.prepare(
    "update ingestion_run set status = ?, error = ?, started_at = coalesce(started_at, ?), finished_at = ? where id = ?",
  );
  const setUsage = db.prepare("update ingestion_run set usage_json = ? where id = ?");
  const setBudget = db.prepare("update ingestion_run set budget_json = ? where id = ?");
  const setReport = db.prepare("update ingestion_run set report_json = ? where id = ?");
  const setParamsStmt = db.prepare("update ingestion_run set params_json = ? where id = ?");
  const repo: IngestionRunsRepo = {
    create(input) {
      const id = newId();
      insert.run(
        id,
        input.fileId,
        input.fileId,
        input.provider,
        JSON.stringify(input.models),
        JSON.stringify(input.options),
        input.depth ?? "quick",
        input.model ?? null,
        nowUtc(),
      );
      return map(get.get(id) as Row);
    },
    createGithub(input) {
      const id = newId();
      insertGithub.run(
        id,
        input.mode,
        input.provider,
        input.depth,
        input.model,
        JSON.stringify(input.params),
        JSON.stringify(input.budget),
        input.parentRunId ?? null,
        nowUtc(),
      );
      return map(get.get(id) as Row);
    },
    // preparados no primeiro uso: testes de migração antigos montam os repos sobre schemas sem as colunas
    linkChat(id, sessionId) {
      db.prepare("update ingestion_run set chat_session_id = ? where id = ?").run(sessionId, id);
    },
    claimChatNotice(id) {
      return (
        db
          .prepare(
            "update ingestion_run set chat_notified_at = ? where id = ? and chat_notified_at is null",
          )
          .run(nowUtc(), id).changes === 1
      );
    },
    get(id) {
      const row = get.get(id) as Row | undefined;
      return row ? map(row) : null;
    },
    listByFile(fileId) {
      return (byFile.all(fileId) as Row[]).map(map);
    },
    list(filter = {}) {
      return (all.all() as Row[])
        .map(map)
        .filter((r) => !filter.status || filter.status.includes(r.status))
        .filter((r) => !filter.source || r.source === filter.source);
    },
    listChildren(parentId) {
      return (all.all() as Row[])
        .map(map)
        .filter((r) => r.parentRunId === parentId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    setEstimate(id, estimate) {
      setEst.run(JSON.stringify(estimate), id);
    },
    setStatus(id, status, patch) {
      const now = nowUtc();
      const startedMarker = status === "running" ? now : null;
      setStatus.run(
        status,
        patch?.error ?? null,
        startedMarker,
        TERMINAL.has(status) ? now : null,
        id,
      );
    },
    addUsage(id, call, usage) {
      const current = repo.get(id);
      if (!current) throw new Error(`Run não encontrado: ${id}`);
      const next: RunUsage = { ...(current.usage ?? {}), [call]: usage };
      setUsage.run(JSON.stringify(next), id);
    },
    usedTokens(id) {
      const usage = repo.get(id)?.usage ?? {};
      return Object.values(usage).reduce(
        (acc, u) => acc + (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0),
        0,
      );
    },
    setBudget(id, budget) {
      setBudget.run(JSON.stringify(budget), id);
    },
    setReport(id, report) {
      setReport.run(JSON.stringify(report), id);
    },
    setParams(id, params) {
      setParamsStmt.run(JSON.stringify(params), id);
    },
  };
  return repo;
}
