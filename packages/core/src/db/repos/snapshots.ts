import { nowUtc } from "@narnia-jobs/shared";
import { newId } from "../../ids";
import type { Db } from "../open";
import { type Row, str } from "../sql";

/** Snapshots do que foi lido (F03 §3, F03-9): permitem re-rodar sem rede; teto configurável, limpeza LRU manual. */
export interface SnapshotRecord {
  id: string;
  source: string;
  ref: string;
  headSha: string | null;
  path: string;
  sha256: string;
  size: number;
  takenAt: string;
  lastUsedAt: string | null;
}
export type SnapshotInput = Omit<SnapshotRecord, "id" | "takenAt" | "lastUsedAt">;

export interface SnapshotsRepo {
  create(input: SnapshotInput): SnapshotRecord;
  get(id: string): SnapshotRecord | null;
  list(): SnapshotRecord[];
  /** Marca uso (re-rodar a partir do snapshot). */
  touch(id: string): void;
  remove(id: string): void;
  totalBytes(): number;
  /** Menos usados primeiro (nunca usado conta pela data de criação): candidatos à limpeza manual. */
  lru(): SnapshotRecord[];
}

function map(r: Row): SnapshotRecord {
  return {
    id: String(r.id),
    source: String(r.source),
    ref: String(r.ref),
    headSha: str(r.head_sha),
    path: String(r.path),
    sha256: String(r.sha256),
    size: Number(r.size),
    takenAt: String(r.taken_at),
    lastUsedAt: str(r.last_used_at),
  };
}

export function snapshotsRepo(db: Db): SnapshotsRepo {
  const insert = db.prepare(
    "insert into snapshot (id, source, ref, head_sha, path, sha256, size, taken_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const get = db.prepare("select * from snapshot where id = ?");
  const all = db.prepare("select * from snapshot order by taken_at desc, rowid desc");
  const lru = db.prepare("select * from snapshot order by coalesce(last_used_at, taken_at), rowid");
  const touch = db.prepare("update snapshot set last_used_at = ? where id = ?");
  const del = db.prepare("delete from snapshot where id = ?");
  const total = db.prepare("select coalesce(sum(size), 0) as n from snapshot");
  let clock = "";
  /** Garante instantes estritamente crescentes no mesmo milissegundo (ordem LRU determinística). */
  const tick = () => {
    const now = nowUtc();
    clock = now > clock ? now : new Date(new Date(clock).getTime() + 1).toISOString();
    return clock;
  };
  const repo: SnapshotsRepo = {
    create(i) {
      const id = newId();
      insert.run(id, i.source, i.ref, i.headSha, i.path, i.sha256, i.size, tick());
      return repo.get(id) as SnapshotRecord;
    },
    get(id) {
      const row = get.get(id) as Row | undefined;
      return row ? map(row) : null;
    },
    list() {
      return (all.all() as Row[]).map(map);
    },
    touch(id) {
      touch.run(tick(), id);
    },
    remove(id) {
      del.run(id);
    },
    totalBytes() {
      return Number((total.get() as { n: number }).n);
    },
    lru() {
      return (lru.all() as Row[]).map(map);
    },
  };
  return repo;
}
