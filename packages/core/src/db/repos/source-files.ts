import { nowUtc } from "@narnia-jobs/shared";
import { newId } from "../../ids";
import type { Db } from "../open";
import { type Row, str } from "../sql";

export type SourceFileKind = "cv" | "text";

export interface SourceFileRecord {
  id: string;
  originalName: string | null;
  mime: string;
  size: number;
  sha256: string;
  path: string;
  kind: SourceFileKind;
  uploadedAt: string;
}
export type SourceFileInput = Omit<SourceFileRecord, "id" | "uploadedAt" | "originalName"> & {
  originalName?: string | null;
};

export interface SourceFilesRepo {
  insert(input: SourceFileInput): SourceFileRecord;
  get(id: string): SourceFileRecord | null;
  findBySha256(sha256: string): SourceFileRecord | null;
  list(): SourceFileRecord[];
}

function map(r: Row): SourceFileRecord {
  return {
    id: String(r.id),
    originalName: str(r.original_name),
    mime: String(r.mime),
    size: Number(r.size),
    sha256: String(r.sha256),
    path: String(r.path),
    kind: String(r.kind) as SourceFileKind,
    uploadedAt: String(r.uploaded_at),
  };
}

export function sourceFilesRepo(db: Db): SourceFilesRepo {
  const insert = db.prepare(
    "insert into source_file (id, original_name, mime, size, sha256, path, kind, uploaded_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const get = db.prepare("select * from source_file where id = ?");
  const bySha = db.prepare(
    "select * from source_file where sha256 = ? order by uploaded_at desc limit 1",
  );
  const list = db.prepare("select * from source_file order by uploaded_at desc, rowid desc");
  return {
    insert(input) {
      const id = newId();
      insert.run(
        id,
        input.originalName ?? null,
        input.mime,
        input.size,
        input.sha256,
        input.path,
        input.kind,
        nowUtc(),
      );
      return map(get.get(id) as Row);
    },
    get(id) {
      const row = get.get(id) as Row | undefined;
      return row ? map(row) : null;
    },
    findBySha256(sha256) {
      const row = bySha.get(sha256) as Row | undefined;
      return row ? map(row) : null;
    },
    list() {
      return (list.all() as Row[]).map(map);
    },
  };
}
