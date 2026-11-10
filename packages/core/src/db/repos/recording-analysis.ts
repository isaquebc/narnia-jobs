import type {
  RecordingEvent,
  RecordingPerson,
  RecordingReport,
  RecordingReportContent,
  RecordingTurn,
} from "@narnia-jobs/shared";
import { newId } from "../../ids";
import { type Db, withTransaction } from "../open";
import { bool, json, num, type Row, str } from "../sql";

/** F13/M4 · pessoas, turnos, eventos e relatórios de uma entrevista gravada (migração 0038). */
export type PersonInsert = Omit<RecordingPerson, "id">;
export type TurnInsert = Omit<RecordingTurn, "id"> & { words?: unknown[] };
export type EventInsert = Omit<RecordingEvent, "id">;

export interface RecordingAnalysisRepo {
  /** Troca toda a análise (pessoas, turnos, eventos) de uma vez; os relatórios ficam. Devolve os ids por chave. */
  replace(
    recordingId: string,
    input: {
      persons: PersonInsert[];
      turns: Array<Omit<TurnInsert, "personId"> & { personKey: string | null }>;
      events: Array<Omit<EventInsert, "personId"> & { personKey: string | null }>;
    },
  ): void;
  persons(recordingId: string): RecordingPerson[];
  person(id: string): (RecordingPerson & { recordingId: string }) | null;
  updatePerson(
    id: string,
    patch: Partial<
      Pick<
        RecordingPerson,
        "name" | "nameSource" | "isCandidate" | "candidateSource" | "contactId" | "card"
      >
    >,
  ): RecordingPerson;
  turns(recordingId: string): RecordingTurn[];
  turnWords(recordingId: string): Array<{ idx: number; words: unknown[] }>;
  turn(id: string): (RecordingTurn & { recordingId: string }) | null;
  setTurnPerson(id: string, personId: string): RecordingTurn;
  events(recordingId: string): RecordingEvent[];
  updateEvent(
    recordingId: string,
    key: string,
    patch: { reading?: string | null; reason?: string | null; frame?: string | null },
  ): void;
  addReport(
    recordingId: string,
    input: {
      content: RecordingReportContent;
      warnings: string[];
      model: string | null;
      usageEventId: string | null;
    },
    now?: Date,
  ): RecordingReport;
  latestReport(recordingId: string): RecordingReport | null;
}

const person = (r: Row): RecordingPerson & { recordingId: string } => ({
  id: String(r.id),
  recordingId: String(r.recording_id),
  key: String(r.key),
  name: str(r.name),
  nameSource: str(r.name_source) as RecordingPerson["nameSource"],
  isCandidate: bool(r.is_candidate),
  candidateSource: str(r.candidate_source) as RecordingPerson["candidateSource"],
  contactId: str(r.contact_id),
  speaker: str(r.speaker),
  track: str(r.track),
  ambiguous: bool(r.ambiguous),
  measurements: json<Record<string, unknown>>(r.measurements, {}),
  card: json<Record<string, unknown> | null>(r.card, null),
});
const turn = (r: Row): RecordingTurn & { recordingId: string } => ({
  id: String(r.id),
  recordingId: String(r.recording_id),
  idx: Number(r.idx),
  personId: str(r.person_id),
  start: Number(r.start_s),
  end: Number(r.end_s),
  text: String(r.text),
  corrected: bool(r.corrected),
});
const event = (r: Row): RecordingEvent => ({
  id: String(r.id),
  key: String(r.key),
  personId: str(r.person_id),
  t: Number(r.t),
  durationS: num(r.duration_s),
  type: String(r.type) as RecordingEvent["type"],
  level: str(r.level) as RecordingEvent["level"],
  reading: str(r.reading) as RecordingEvent["reading"],
  reason: str(r.reason),
  turnIdx: num(r.turn_idx),
  frame: str(r.frame),
  data: json<Record<string, unknown>>(r.data, {}),
});
const report = (r: Row): RecordingReport => ({
  id: String(r.id),
  version: Number(r.version),
  content: json<RecordingReportContent>(r.content, {} as RecordingReportContent),
  warnings: json<string[]>(r.warnings, []),
  model: str(r.model),
  createdAt: String(r.created_at),
});
const strip = <T extends { recordingId: string }>(x: T) => {
  const { recordingId: _r, ...rest } = x;
  return rest;
};

export function recordingAnalysisRepo(db: Db): RecordingAnalysisRepo {
  const one = (sql: string, ...args: Array<string | number>) =>
    db.prepare(sql).get(...args) as Row | undefined;
  const all = (sql: string, ...args: Array<string | number>) =>
    db.prepare(sql).all(...args) as Row[];
  return {
    replace(recordingId, input) {
      withTransaction(db, () => {
        for (const table of [
          "recorded_interview_event",
          "recorded_interview_turn",
          "recorded_interview_person",
        ])
          db.prepare(`delete from ${table} where recording_id = ?`).run(recordingId);
        const ids = new Map<string, string>();
        input.persons.forEach((p, i) => {
          const id = newId();
          ids.set(p.key, id);
          db.prepare(
            `insert into recorded_interview_person (id, recording_id, key, name, name_source, is_candidate,
               candidate_source, contact_id, speaker, track, ambiguous, measurements, card, position)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            id,
            recordingId,
            p.key,
            p.name,
            p.nameSource,
            p.isCandidate ? 1 : 0,
            p.candidateSource,
            p.contactId,
            p.speaker,
            p.track,
            p.ambiguous ? 1 : 0,
            JSON.stringify(p.measurements),
            p.card ? JSON.stringify(p.card) : null,
            i,
          );
        });
        const pid = (key: string | null) => (key ? (ids.get(key) ?? null) : null);
        for (const t of input.turns)
          db.prepare(
            `insert into recorded_interview_turn (id, recording_id, idx, person_id, start_s, end_s, text, words, corrected)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            newId(),
            recordingId,
            t.idx,
            pid(t.personKey),
            t.start,
            t.end,
            t.text,
            JSON.stringify(t.words ?? []),
            t.corrected ? 1 : 0,
          );
        for (const e of input.events)
          db.prepare(
            `insert into recorded_interview_event (id, recording_id, key, person_id, t, duration_s, type, level, reading,
               reason, turn_idx, frame, data) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            newId(),
            recordingId,
            e.key,
            pid(e.personKey),
            e.t,
            e.durationS,
            e.type,
            e.level,
            e.reading,
            e.reason,
            e.turnIdx,
            e.frame,
            JSON.stringify(e.data),
          );
      });
    },
    persons(recordingId) {
      return all(
        "select * from recorded_interview_person where recording_id = ? order by position",
        recordingId,
      ).map((r) => strip(person(r)));
    },
    person(id) {
      const r = one("select * from recorded_interview_person where id = ?", id);
      return r ? person(r) : null;
    },
    updatePerson(id, patch) {
      const sets: string[] = [];
      const args: Array<string | number | null> = [];
      const put = (col: string, v: string | number | null) => {
        sets.push(`${col} = ?`);
        args.push(v);
      };
      if (patch.name !== undefined) put("name", patch.name);
      if (patch.nameSource !== undefined) put("name_source", patch.nameSource);
      if (patch.isCandidate !== undefined) put("is_candidate", patch.isCandidate ? 1 : 0);
      if (patch.candidateSource !== undefined) put("candidate_source", patch.candidateSource);
      if (patch.contactId !== undefined) put("contact_id", patch.contactId);
      if (patch.card !== undefined) put("card", patch.card ? JSON.stringify(patch.card) : null);
      if (sets.length)
        db.prepare(`update recorded_interview_person set ${sets.join(", ")} where id = ?`).run(
          ...args,
          id,
        );
      const r = one("select * from recorded_interview_person where id = ?", id);
      if (!r) throw new Error(`pessoa ${id} não existe`);
      return strip(person(r));
    },
    turns(recordingId) {
      return all(
        "select * from recorded_interview_turn where recording_id = ? order by idx",
        recordingId,
      ).map((r) => strip(turn(r)));
    },
    turnWords(recordingId) {
      return all(
        "select idx, words from recorded_interview_turn where recording_id = ? order by idx",
        recordingId,
      ).map((r) => ({ idx: Number(r.idx), words: json<unknown[]>(r.words, []) }));
    },
    turn(id) {
      const r = one("select * from recorded_interview_turn where id = ?", id);
      return r ? turn(r) : null;
    },
    setTurnPerson(id, personId) {
      db.prepare(
        "update recorded_interview_turn set person_id = ?, corrected = 1 where id = ?",
      ).run(personId, id);
      const r = one("select * from recorded_interview_turn where id = ?", id);
      if (!r) throw new Error(`turno ${id} não existe`);
      return strip(turn(r));
    },
    events(recordingId) {
      return all(
        "select * from recorded_interview_event where recording_id = ? order by t, key",
        recordingId,
      ).map(event);
    },
    updateEvent(recordingId, key, patch) {
      const sets: string[] = [];
      const args: Array<string | null> = [];
      for (const [col, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        sets.push(`${col} = ?`);
        args.push(v);
      }
      if (sets.length)
        db.prepare(
          `update recorded_interview_event set ${sets.join(", ")} where recording_id = ? and key = ?`,
        ).run(...args, recordingId, key);
    },
    addReport(recordingId, input, now = new Date()) {
      const last = one(
        "select max(version) as v from recorded_interview_report where recording_id = ?",
        recordingId,
      );
      const id = newId();
      db.prepare(
        `insert into recorded_interview_report (id, recording_id, version, content, warnings, model, usage_event_id,
           created_at) values (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        recordingId,
        Number(last?.v ?? 0) + 1,
        JSON.stringify(input.content),
        JSON.stringify(input.warnings),
        input.model,
        input.usageEventId,
        now.toISOString(),
      );
      return report(one("select * from recorded_interview_report where id = ?", id) as Row);
    },
    latestReport(recordingId) {
      const r = one(
        "select * from recorded_interview_report where recording_id = ? order by version desc limit 1",
        recordingId,
      );
      return r ? report(r) : null;
    },
  };
}
