import { nowUtc } from "@narnia-jobs/shared";
import { newId } from "../../ids";
import type { Db } from "../open";
import { withTransaction } from "../open";
import { json, num, type Row, str } from "../sql";

export type ReadingKind = "text_layer" | "ocr" | "model_read";

export interface ReadingRecord {
  id: string;
  runId: string;
  kind: ReadingKind;
  textPath: string;
  quality: number;
  pages: unknown;
  usage: unknown;
  durationMs: number | null;
  createdAt: string;
}
export type ReadingInput = Omit<
  ReadingRecord,
  "id" | "createdAt" | "pages" | "usage" | "durationMs"
> & {
  pages?: unknown;
  usage?: unknown;
  durationMs?: number;
};

export interface SegmentDivergence {
  token: string;
  values: Record<string, string>;
  chosen: string;
}
export interface SegmentInput {
  index: number;
  sectionHint: string | null;
  text: string;
  origin: ReadingKind;
  agreement: number;
  divergences: SegmentDivergence[];
}
export interface SegmentRecord extends SegmentInput {
  id: string;
  runId: string;
}

export interface ReadingsRepo {
  insert(input: ReadingInput): ReadingRecord;
  listByRun(runId: string): ReadingRecord[];
  replaceSegments(runId: string, segments: SegmentInput[]): void;
  segmentsByRun(runId: string): SegmentRecord[];
}

function mapReading(r: Row): ReadingRecord {
  return {
    id: String(r.id),
    runId: String(r.run_id),
    kind: String(r.kind) as ReadingKind,
    textPath: String(r.text_path),
    quality: Number(r.quality),
    pages: json(r.pages_json, null),
    usage: json(r.usage_json, null),
    durationMs: num(r.duration_ms),
    createdAt: String(r.created_at),
  };
}
function mapSegment(r: Row): SegmentRecord {
  return {
    id: String(r.id),
    runId: String(r.run_id),
    index: Number(r.idx),
    sectionHint: str(r.section_hint),
    text: String(r.text),
    origin: String(r.origin) as ReadingKind,
    agreement: Number(r.agreement),
    divergences: json<SegmentDivergence[]>(r.divergences_json, []),
  };
}

export function readingsRepo(db: Db): ReadingsRepo {
  const insert = db.prepare(
    "insert into reading (id, run_id, kind, text_path, quality, pages_json, usage_json, duration_ms, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const get = db.prepare("select * from reading where id = ?");
  const byRun = db.prepare("select * from reading where run_id = ? order by created_at, rowid");
  const delSeg = db.prepare("delete from reading_segment where run_id = ?");
  const insSeg = db.prepare(
    "insert into reading_segment (id, run_id, idx, section_hint, text, origin, agreement, divergences_json) values (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const segByRun = db.prepare("select * from reading_segment where run_id = ? order by idx");
  return {
    insert(input) {
      const id = newId();
      insert.run(
        id,
        input.runId,
        input.kind,
        input.textPath,
        input.quality,
        input.pages === undefined ? null : JSON.stringify(input.pages),
        input.usage === undefined ? null : JSON.stringify(input.usage),
        input.durationMs ?? null,
        nowUtc(),
      );
      return mapReading(get.get(id) as Row);
    },
    listByRun(runId) {
      return (byRun.all(runId) as Row[]).map(mapReading);
    },
    replaceSegments(runId, segments) {
      withTransaction(db, () => {
        delSeg.run(runId);
        for (const s of segments) {
          insSeg.run(
            newId(),
            runId,
            s.index,
            s.sectionHint,
            s.text,
            s.origin,
            s.agreement,
            JSON.stringify(s.divergences),
          );
        }
      });
    },
    segmentsByRun(runId) {
      return (segByRun.all(runId) as Row[]).map(mapSegment);
    },
  };
}
