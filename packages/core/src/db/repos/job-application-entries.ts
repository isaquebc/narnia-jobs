import type { JobApplicationAttachment, JobApplicationEntry } from "@narnia-jobs/shared";
import { newId } from "../../ids";
import { type Db, withTransaction } from "../open";
import type { Row } from "../sql";

export interface AttachmentRecord {
  id: string;
  fileName: string;
  mime: string;
  size: number;
}

/** Notas e anexos datados da candidatura (F07/M3, migração 0030). */
export interface JobApplicationEntriesRepo {
  /** Os ids dos anexos vêm de quem grava os arquivos (o nome no disco é o id). */
  create(
    input: {
      applicationId: string;
      occurredOn: string;
      body: string | null;
      attachments: AttachmentRecord[];
    },
    now?: Date,
  ): JobApplicationEntry;
  get(id: string): JobApplicationEntry | null;
  /** Mais recentes primeiro (data escolhida, depois criação). */
  list(applicationId: string): JobApplicationEntry[];
  update(
    id: string,
    patch: { occurredOn?: string; body?: string | null },
    now?: Date,
  ): JobApplicationEntry;
  remove(id: string): void;
  attachment(id: string): (JobApplicationAttachment & { applicationId: string }) | null;
  attachmentIds(applicationId: string): string[];
}

export function jobApplicationEntriesRepo(db: Db): JobApplicationEntriesRepo {
  const attachmentsOf = (entryId: string): JobApplicationAttachment[] =>
    (
      db
        .prepare(
          "select id, file_name, mime, size, created_at from job_application_attachment where entry_id = ? order by position",
        )
        .all(entryId) as Row[]
    ).map((a) => ({
      id: String(a.id),
      fileName: String(a.file_name),
      mime: String(a.mime),
      size: Number(a.size),
      createdAt: String(a.created_at),
    }));
  const map = (r: Row): JobApplicationEntry => ({
    id: String(r.id),
    applicationId: String(r.job_application_id),
    occurredOn: String(r.occurred_on),
    body: r.body === null ? null : String(r.body),
    attachments: attachmentsOf(String(r.id)),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  });
  const get = (id: string) => {
    const r = db.prepare("select * from job_application_entry where id = ?").get(id) as
      | Row
      | undefined;
    return r ? map(r) : null;
  };
  const must = (id: string) => {
    const e = get(id);
    if (!e) throw new Error(`nota ${id} não existe`);
    return e;
  };
  return {
    create(input, now = new Date()) {
      const id = newId();
      const at = now.toISOString();
      withTransaction(db, () => {
        db.prepare(
          `insert into job_application_entry (id, job_application_id, occurred_on, body, created_at, updated_at)
             values (?, ?, ?, ?, ?, ?)`,
        ).run(id, input.applicationId, input.occurredOn, input.body, at, at);
        const ins = db.prepare(
          `insert into job_application_attachment (id, entry_id, file_name, mime, size, position, created_at)
             values (?, ?, ?, ?, ?, ?, ?)`,
        );
        input.attachments.forEach((a, i) => {
          ins.run(a.id, id, a.fileName, a.mime, a.size, i + 1, at);
        });
      });
      return must(id);
    },
    get,
    list(applicationId) {
      return (
        db
          .prepare(
            `select * from job_application_entry where job_application_id = ?
               order by occurred_on desc, created_at desc, rowid desc`,
          )
          .all(applicationId) as Row[]
      ).map(map);
    },
    update(id, patch, now = new Date()) {
      const cur = must(id);
      db.prepare(
        "update job_application_entry set occurred_on = ?, body = ?, updated_at = ? where id = ?",
      ).run(
        patch.occurredOn ?? cur.occurredOn,
        patch.body !== undefined ? patch.body : cur.body,
        now.toISOString(),
        id,
      );
      return must(id);
    },
    remove(id) {
      db.prepare("delete from job_application_entry where id = ?").run(id);
    },
    attachment(id) {
      const r = db
        .prepare(
          `select a.id, a.file_name, a.mime, a.size, a.created_at, e.job_application_id from job_application_attachment a
             join job_application_entry e on e.id = a.entry_id where a.id = ?`,
        )
        .get(id) as Row | undefined;
      if (!r) return null;
      return {
        id: String(r.id),
        fileName: String(r.file_name),
        mime: String(r.mime),
        size: Number(r.size),
        createdAt: String(r.created_at),
        applicationId: String(r.job_application_id),
      };
    },
    attachmentIds(applicationId) {
      return (
        db
          .prepare(
            `select a.id from job_application_attachment a join job_application_entry e on e.id = a.entry_id
               where e.job_application_id = ?`,
          )
          .all(applicationId) as Row[]
      ).map((r) => String(r.id));
    },
  };
}
