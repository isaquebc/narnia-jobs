import { nowUtc } from "@narnia-jobs/shared";
import { newId } from "../../ids";
import type { Db } from "../open";
import { type Row, str } from "../sql";

export type FactSourceKind =
  | "cv"
  | "text"
  | "github"
  | "linkedin"
  | "chat"
  | "clarificacao"
  | "pesquisa"
  | "manual";

export interface FactSourceRecord {
  id: string;
  kind: FactSourceKind;
  fileId: string | null;
  runId: string | null;
  url: string | null;
  /** F03: repositório e análise de origem (GitHub). */
  repoId: string | null;
  analysisId: string | null;
  createdAt: string;
}

export interface FactSourcesRepo {
  create(input: {
    kind: FactSourceKind;
    fileId?: string | null;
    runId?: string | null;
    url?: string | null;
    repoId?: string | null;
    analysisId?: string | null;
  }): FactSourceRecord;
  get(id: string): FactSourceRecord | null;
  /**
   * Fontes de um fato (F03 §3: "aceitar sobre entidade existente gera novo fact_source, nada é substituído"): a
   * fonte gravada no fato mais a de cada execução cuja proposta aceita apontou para ele (`target_id`).
   */
  listForFact(kind: FactKindWithTable, factId: string): FactSourceRecord[];
}

export type FactKindWithTable =
  | "experience"
  | "achievement"
  | "education"
  | "skill"
  | "language"
  | "project";

const FACT_TABLE: Record<FactKindWithTable, string> = {
  experience: "experience",
  achievement: "achievement",
  education: "education",
  skill: "skill",
  language: "language",
  project: "project",
};

export function factSourcesRepo(db: Db): FactSourcesRepo {
  const insert = db.prepare(
    "insert into fact_source (id, kind, file_id, run_id, url, repo_id, analysis_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const get = db.prepare("select * from fact_source where id = ?");
  const map = (r: Row): FactSourceRecord => ({
    id: String(r.id),
    kind: String(r.kind) as FactSourceKind,
    fileId: str(r.file_id),
    runId: str(r.run_id),
    url: str(r.url),
    repoId: str(r.repo_id),
    analysisId: str(r.analysis_id),
    createdAt: String(r.created_at),
  });
  return {
    create(input) {
      const id = newId();
      insert.run(
        id,
        input.kind,
        input.fileId ?? null,
        input.runId ?? null,
        input.url ?? null,
        input.repoId ?? null,
        input.analysisId ?? null,
        nowUtc(),
      );
      return map(get.get(id) as Row);
    },
    get(id) {
      const row = get.get(id) as Row | undefined;
      return row ? map(row) : null;
    },
    listForFact(kind, factId) {
      const table = FACT_TABLE[kind];
      const rows = db
        .prepare(
          `select fs.* from fact_source fs where fs.id = (select source_id from ${table} where id = ?)
           union
           select fs.* from fact_source fs
             join ingestion_proposal p on p.run_id = fs.run_id
            where p.target_id = ? and p.kind = ? and p.decision in ('accepted', 'edited')
           order by created_at`,
        )
        .all(factId, factId, kind) as Row[];
      return rows.map(map);
    },
  };
}
