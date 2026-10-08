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
  createdAt: string;
}

export interface FactSourcesRepo {
  create(input: {
    kind: FactSourceKind;
    fileId?: string | null;
    runId?: string | null;
    url?: string | null;
  }): FactSourceRecord;
  get(id: string): FactSourceRecord | null;
}

export function factSourcesRepo(db: Db): FactSourcesRepo {
  const insert = db.prepare(
    "insert into fact_source (id, kind, file_id, run_id, url, created_at) values (?, ?, ?, ?, ?, ?)",
  );
  const get = db.prepare("select * from fact_source where id = ?");
  const map = (r: Row): FactSourceRecord => ({
    id: String(r.id),
    kind: String(r.kind) as FactSourceKind,
    fileId: str(r.file_id),
    runId: str(r.run_id),
    url: str(r.url),
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
        nowUtc(),
      );
      return map(get.get(id) as Row);
    },
    get(id) {
      const row = get.get(id) as Row | undefined;
      return row ? map(row) : null;
    },
  };
}
