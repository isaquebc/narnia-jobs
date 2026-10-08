import { type FileDigest, FileDigestSchema, nowUtc } from "@narnia-jobs/shared";
import type { Db } from "../open";
import { bool, json, type Row, str } from "../sql";

export interface DigestRecord extends FileDigest {
  textPath: string | null;
  updatedAt: string;
}
export type DigestInput = FileDigest & { textPath?: string | null };

export interface DigestsRepo {
  /** Insere ou substitui. Se o registro existente foi editado pelo usuário, preserva resumo/pontos/seções. */
  upsert(input: DigestInput): DigestRecord;
  get(fileId: string): DigestRecord | null;
}

function map(r: Row): DigestRecord {
  const parsed = FileDigestSchema.parse({
    fileId: String(r.file_id),
    summary: String(r.summary),
    keyPoints: json(r.key_points_json, []),
    sections: json(r.sections_json, []),
    meta: json(r.meta_json, {}),
    editedByUser: bool(r.edited_by_user),
  });
  return { ...parsed, textPath: str(r.text_path), updatedAt: String(r.updated_at) };
}

export function digestsRepo(db: Db): DigestsRepo {
  const get = db.prepare("select * from file_digest where file_id = ?");
  const upsert = db.prepare(
    `insert into file_digest (file_id, summary, key_points_json, sections_json, meta_json, text_path, edited_by_user, updated_at)
     values (@file_id, @summary, @key_points_json, @sections_json, @meta_json, @text_path, @edited_by_user, @updated_at)
     on conflict (file_id) do update set summary = excluded.summary, key_points_json = excluded.key_points_json,
       sections_json = excluded.sections_json, meta_json = excluded.meta_json, text_path = excluded.text_path,
       edited_by_user = excluded.edited_by_user, updated_at = excluded.updated_at`,
  );
  const repo: DigestsRepo = {
    upsert(input) {
      const valid = FileDigestSchema.parse(input);
      const existing = repo.get(valid.fileId);
      const keepUser = existing?.editedByUser && !valid.editedByUser;
      const next = keepUser
        ? {
            ...valid,
            summary: existing.summary,
            keyPoints: existing.keyPoints,
            sections: existing.sections,
            editedByUser: true,
          }
        : valid;
      upsert.run({
        file_id: next.fileId,
        summary: next.summary,
        key_points_json: JSON.stringify(next.keyPoints),
        sections_json: JSON.stringify(next.sections),
        meta_json: JSON.stringify(next.meta),
        text_path: input.textPath ?? existing?.textPath ?? null,
        edited_by_user: next.editedByUser ? 1 : 0,
        updated_at: nowUtc(),
      });
      return repo.get(next.fileId) as DigestRecord;
    },
    get(fileId) {
      const row = get.get(fileId) as Row | undefined;
      return row ? map(row) : null;
    },
  };
  return repo;
}
