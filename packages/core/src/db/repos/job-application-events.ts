import type { JobApplicationEvent, JobApplicationEventKind } from "@narnia-jobs/shared";
import { newId } from "../../ids";
import type { Db } from "../open";
import type { Row } from "../sql";

export interface JobApplicationEventRecord {
  stageId: string | null;
  kind: JobApplicationEventKind;
  title: string;
  startsAt: string;
  durationMin: number;
  timezone: string;
  location: string | null;
  link: string | null;
  notes: string | null;
}

/** Agenda das candidaturas (F07/M5, migração 0031). */
export interface JobApplicationEventsRepo {
  create(applicationId: string, input: JobApplicationEventRecord, now?: Date): JobApplicationEvent;
  get(id: string): JobApplicationEvent | null;
  /** Em ordem de início. */
  list(applicationId: string): JobApplicationEvent[];
  /** Mudar data, hora ou texto sobe o `ics_sequence` (reimportar o `.ics` atualiza o evento). */
  update(
    id: string,
    patch: Partial<JobApplicationEventRecord> & { doneAt?: string | null },
    now?: Date,
  ): JobApplicationEvent;
  remove(id: string): void;
  setGoogleEventId(id: string, googleEventId: string | null): void;
  /** Não concluídos que começam antes de `before`, de candidaturas ativas (não encerradas, não arquivadas). */
  pendingBefore(before: string): JobApplicationEvent[];
}

const COLS: Record<keyof JobApplicationEventRecord, string> = {
  stageId: "stage_id",
  kind: "kind",
  title: "title",
  startsAt: "starts_at",
  durationMin: "duration_min",
  timezone: "timezone",
  location: "location",
  link: "link",
  notes: "notes",
};

const map = (r: Row): JobApplicationEvent => ({
  id: String(r.id),
  applicationId: String(r.job_application_id),
  stageId: r.stage_id === null ? null : String(r.stage_id),
  kind: String(r.kind) as JobApplicationEventKind,
  title: String(r.title),
  startsAt: String(r.starts_at),
  durationMin: Number(r.duration_min),
  timezone: String(r.timezone),
  location: r.location === null ? null : String(r.location),
  link: r.link === null ? null : String(r.link),
  notes: r.notes === null ? null : String(r.notes),
  doneAt: r.done_at === null ? null : String(r.done_at),
  icsSequence: Number(r.ics_sequence),
  googleEventId: r.google_event_id === null ? null : String(r.google_event_id),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

export function jobApplicationEventsRepo(db: Db): JobApplicationEventsRepo {
  const get = (id: string) => {
    const r = db.prepare("select * from job_application_event where id = ?").get(id) as
      | Row
      | undefined;
    return r ? map(r) : null;
  };
  return {
    create(applicationId, input, now = new Date()) {
      const id = newId();
      const at = now.toISOString();
      db.prepare(
        `insert into job_application_event (id, job_application_id, stage_id, kind, title, starts_at, duration_min,
           timezone, location, link, notes, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        applicationId,
        input.stageId,
        input.kind,
        input.title,
        input.startsAt,
        input.durationMin,
        input.timezone,
        input.location,
        input.link,
        input.notes,
        at,
        at,
      );
      return get(id) as JobApplicationEvent;
    },
    get,
    list(applicationId) {
      return (
        db
          .prepare(
            "select * from job_application_event where job_application_id = ? order by starts_at, rowid",
          )
          .all(applicationId) as Row[]
      ).map(map);
    },
    update(id, patch, now = new Date()) {
      const sets: string[] = [];
      const values: Array<string | number | null> = [];
      let content = false;
      for (const [k, col] of Object.entries(COLS) as Array<
        [keyof JobApplicationEventRecord, string]
      >) {
        if (patch[k] === undefined) continue;
        sets.push(`${col} = ?`);
        values.push(patch[k] as string | number | null);
        content = true;
      }
      if (patch.doneAt !== undefined) {
        sets.push("done_at = ?");
        values.push(patch.doneAt);
      }
      if (content) sets.push("ics_sequence = ics_sequence + 1");
      sets.push("updated_at = ?");
      values.push(now.toISOString(), id);
      db.prepare(`update job_application_event set ${sets.join(", ")} where id = ?`).run(...values);
      return get(id) as JobApplicationEvent;
    },
    remove(id) {
      db.prepare("delete from job_application_event where id = ?").run(id);
    },
    setGoogleEventId(id, googleEventId) {
      db.prepare("update job_application_event set google_event_id = ? where id = ?").run(
        googleEventId,
        id,
      );
    },
    pendingBefore(before) {
      return (
        db
          .prepare(
            `select e.* from job_application_event e join job_application a on a.id = e.job_application_id
               where e.done_at is null and e.starts_at < ? and a.archived_at is null and a.board_column <> 'closed'
               order by e.starts_at, e.rowid`,
          )
          .all(before) as Row[]
      ).map(map);
    },
  };
}
