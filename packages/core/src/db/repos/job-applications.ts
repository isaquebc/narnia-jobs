import type {
  JobApplication,
  JobApplicationClosedReason,
  JobApplicationColumn,
  JobApplicationStage,
  LockedDocument,
} from "@narnia-jobs/shared";
import { newId } from "../../ids";
import { type Db, withTransaction } from "../open";
import type { Row } from "../sql";

/** Sem atividade por 40 dias, a candidatura fica arquivada (F07 §0-6). */
export const ARCHIVE_AFTER_DAYS = 40;

export interface JobApplicationCreateRecord {
  postingId: string;
  profileId: string | null;
  cvVersionId: string;
  coverLetterVersionId: string | null;
  appliedOn: string;
  stages: string[];
}

export interface JobApplicationUpdate {
  column?: JobApplicationColumn | undefined;
  closedReason?: JobApplicationClosedReason | null | undefined;
  /** Desclassificação: etapa (nome) e nota do e-mail; só em Encerrado. */
  closedStage?: string | null | undefined;
  closedEntryId?: string | null | undefined;
  appliedOn?: string | undefined;
  archived?: boolean | undefined;
}

/** Candidaturas (F07, migração 0027). Toda mudança conta como atividade e desarquiva. */
export interface JobApplicationsRepo {
  create(input: JobApplicationCreateRecord, now?: Date): JobApplication;
  get(id: string): JobApplication | null;
  /** Mais recentes primeiro (data da candidatura, depois criação). */
  list(filter?: { archived?: boolean | undefined }): JobApplication[];
  /** A mais recente desta vaga, em qualquer estado. */
  latestForPosting(postingId: string): JobApplication | null;
  /** A não encerrada e não arquivada desta vaga (F07-9). */
  activeForPosting(postingId: string): JobApplication | null;
  /** Encerrar pede o motivo (F07-6); sair de Encerrado limpa o motivo. */
  update(id: string, patch: JobApplicationUpdate, now?: Date): JobApplication;
  /**
   * Troca o pipeline pela lista em ordem (F07/M2): as que trazem `id` ficam com ele, as sem id nascem, as que faltam
   * saem. A etapa atual continua se ficou; se saiu, passa para a que ficou na mesma posição (ou a última).
   */
  setStages(
    id: string,
    stages: Array<{ id?: string | undefined; name: string }>,
    now?: Date,
  ): JobApplication;
  setCurrentStage(id: string, stageId: string | null, now?: Date): JobApplication;
  /** Mudanças de coluna em ordem (a primeira é a criação, sem origem): o funil sai daqui. */
  moves(): Array<{
    applicationId: string;
    from: JobApplicationColumn | null;
    to: JobApplicationColumn;
    at: string;
  }>;
  /** Conversa sobre a candidatura (F07/M6). */
  chatSessionId(id: string): string | null;
  setChatSession(id: string, sessionId: string | null): void;
  /** Atividade sem mudar nada (nota, anexo): conta para o arquivamento e desarquiva. */
  touch(id: string, now?: Date): void;
  /** Arquiva as sem atividade há `ARCHIVE_AFTER_DAYS`; devolve os ids. Nunca apaga. */
  archiveInactive(now?: Date): string[];
  remove(id: string): void;
  countForPosting(postingId: string): number;
  countForDocument(documentId: string): number;
}

/** A versão travada com o documento dela (CV da vaga ou geral do perfil). */
function locked(db: Db, versionId: string | null): LockedDocument | null {
  if (!versionId) return null;
  const r = db
    .prepare(
      `select v.id, v.version, d.id as document_id, d.posting_id from document_version v
         join document d on d.id = v.document_id where v.id = ?`,
    )
    .get(versionId) as Row | undefined;
  if (!r) return null;
  return {
    documentId: String(r.document_id),
    versionId: String(r.id),
    version: Number(r.version),
    scope: r.posting_id === null ? "profile" : "posting",
  };
}

export function jobApplicationsRepo(db: Db): JobApplicationsRepo {
  const stagesOf = (id: string): JobApplicationStage[] =>
    (
      db
        .prepare(
          "select id, name, position from job_application_stage where job_application_id = ? order by position",
        )
        .all(id) as Row[]
    ).map((s) => ({ id: String(s.id), name: String(s.name), position: Number(s.position) }));

  const map = (r: Row): JobApplication => ({
    id: String(r.id),
    postingId: String(r.posting_id),
    profileId: r.profile_id === null ? null : String(r.profile_id),
    cv: locked(db, String(r.cv_version_id)) as LockedDocument,
    coverLetter: locked(db, r.cover_letter_version_id as string | null),
    appliedOn: String(r.applied_on),
    column: String(r.board_column) as JobApplicationColumn,
    closedReason: (r.closed_reason as JobApplicationClosedReason | null) ?? null,
    closedStage:
      r.closed_stage === null || r.closed_stage === undefined ? null : String(r.closed_stage),
    closedEntryId:
      r.closed_entry_id === null || r.closed_entry_id === undefined
        ? null
        : String(r.closed_entry_id),
    stages: stagesOf(String(r.id)),
    currentStageId: r.current_stage_id === null ? null : String(r.current_stage_id),
    lastActivityAt: String(r.last_activity_at),
    archivedAt: r.archived_at === null ? null : String(r.archived_at),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  });

  const move = (
    id: string,
    from: JobApplicationColumn | null,
    to: JobApplicationColumn,
    at: string,
  ) =>
    db
      .prepare(
        "insert into job_application_move (id, job_application_id, from_column, to_column, at) values (?, ?, ?, ?, ?)",
      )
      .run(newId(), id, from, to, at);

  const get = (id: string) => {
    const r = db.prepare("select * from job_application where id = ?").get(id) as Row | undefined;
    return r ? map(r) : null;
  };
  const must = (id: string) => {
    const a = get(id);
    if (!a) throw new Error(`candidatura ${id} não existe`);
    return a;
  };

  return {
    create(input, now = new Date()) {
      const id = newId();
      const at = now.toISOString();
      withTransaction(db, () => {
        db.prepare(
          `insert into job_application (id, posting_id, profile_id, cv_version_id, cover_letter_version_id, applied_on,
             last_activity_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          input.postingId,
          input.profileId,
          input.cvVersionId,
          input.coverLetterVersionId,
          input.appliedOn,
          at,
          at,
          at,
        );
        const ins = db.prepare(
          "insert into job_application_stage (id, job_application_id, name, position, created_at) values (?, ?, ?, ?, ?)",
        );
        let first: string | null = null;
        input.stages.forEach((name, i) => {
          const sid = newId();
          first ??= sid;
          ins.run(sid, id, name, i + 1, at);
        });
        db.prepare("update job_application set current_stage_id = ? where id = ?").run(first, id);
        move(id, null, "applied", at);
      });
      return must(id);
    },
    get,
    list(filter = {}) {
      const where =
        filter.archived === undefined
          ? ""
          : filter.archived
            ? "where archived_at is not null"
            : "where archived_at is null";
      return (
        db
          .prepare(
            `select * from job_application ${where} order by applied_on desc, created_at desc, rowid desc`,
          )
          .all() as Row[]
      ).map(map);
    },
    latestForPosting(postingId) {
      const r = db
        .prepare(
          "select * from job_application where posting_id = ? order by created_at desc, rowid desc limit 1",
        )
        .get(postingId) as Row | undefined;
      return r ? map(r) : null;
    },
    activeForPosting(postingId) {
      const r = db
        .prepare(
          `select * from job_application where posting_id = ? and archived_at is null and board_column <> 'closed'
             order by created_at desc limit 1`,
        )
        .get(postingId) as Row | undefined;
      return r ? map(r) : null;
    },
    update(id, patch, now = new Date()) {
      const cur = must(id);
      const column = patch.column ?? cur.column;
      const reason =
        column === "closed"
          ? patch.closedReason !== undefined
            ? patch.closedReason
            : cur.column === "closed"
              ? cur.closedReason
              : null
          : null;
      if (column === "closed" && !reason) throw new Error("encerrar pede o motivo");
      const keep = <T>(next: T | undefined, prev: T | null) =>
        column !== "closed"
          ? null
          : next !== undefined
            ? next
            : cur.column === "closed"
              ? prev
              : null;
      const stage = keep(patch.closedStage, cur.closedStage);
      const entry = keep(patch.closedEntryId, cur.closedEntryId);
      const at = now.toISOString();
      const archivedAt = patch.archived === true ? (cur.archivedAt ?? at) : null;
      if (column !== cur.column) move(id, cur.column, column, at);
      db.prepare(
        `update job_application set board_column = ?, closed_reason = ?, closed_stage = ?, closed_entry_id = ?,
           applied_on = ?, archived_at = ?, last_activity_at = ?, updated_at = ? where id = ?`,
      ).run(column, reason, stage, entry, patch.appliedOn ?? cur.appliedOn, archivedAt, at, at, id);
      return must(id);
    },
    setStages(id, stages, now = new Date()) {
      const cur = must(id);
      const at = now.toISOString();
      withTransaction(db, () => {
        const keep = new Set(stages.flatMap((s) => (s.id ? [s.id] : [])));
        const del = db.prepare("delete from job_application_stage where id = ?");
        for (const s of cur.stages) if (!keep.has(s.id)) del.run(s.id);
        const upd = db.prepare(
          "update job_application_stage set name = ?, position = ? where id = ?",
        );
        const ins = db.prepare(
          "insert into job_application_stage (id, job_application_id, name, position, created_at) values (?, ?, ?, ?, ?)",
        );
        const ids = stages.map((s, i) => {
          if (s.id) {
            upd.run(s.name, i + 1, s.id);
            return s.id;
          }
          const sid = newId();
          ins.run(sid, id, s.name, i + 1, at);
          return sid;
        });
        const old = cur.stages.find((s) => s.id === cur.currentStageId);
        const current =
          cur.currentStageId && keep.has(cur.currentStageId)
            ? cur.currentStageId
            : old
              ? (ids[Math.min(old.position, ids.length) - 1] ?? null)
              : (ids[0] ?? null);
        db.prepare(
          `update job_application set current_stage_id = ?, archived_at = null, last_activity_at = ?, updated_at = ?
             where id = ?`,
        ).run(current, at, at, id);
      });
      return must(id);
    },
    setCurrentStage(id, stageId, now = new Date()) {
      must(id);
      const at = now.toISOString();
      db.prepare(
        `update job_application set current_stage_id = ?, archived_at = null, last_activity_at = ?, updated_at = ?
           where id = ?`,
      ).run(stageId, at, at, id);
      return must(id);
    },
    moves() {
      return (
        db
          .prepare(
            "select job_application_id, from_column, to_column, at from job_application_move order by at, rowid",
          )
          .all() as Row[]
      ).map((r) => ({
        applicationId: String(r.job_application_id),
        from: (r.from_column as JobApplicationColumn | null) ?? null,
        to: String(r.to_column) as JobApplicationColumn,
        at: String(r.at),
      }));
    },
    chatSessionId(id) {
      const r = db.prepare("select chat_session_id from job_application where id = ?").get(id) as
        | Row
        | undefined;
      return r?.chat_session_id ? String(r.chat_session_id) : null;
    },
    setChatSession(id, sessionId) {
      db.prepare("update job_application set chat_session_id = ? where id = ?").run(sessionId, id);
    },
    touch(id, now = new Date()) {
      const at = now.toISOString();
      db.prepare(
        "update job_application set archived_at = null, last_activity_at = ?, updated_at = ? where id = ?",
      ).run(at, at, id);
    },
    archiveInactive(now = new Date()) {
      const limit = new Date(now.getTime() - ARCHIVE_AFTER_DAYS * 86_400_000).toISOString();
      const ids = (
        db
          .prepare(
            "select id from job_application where archived_at is null and last_activity_at < ? order by rowid",
          )
          .all(limit) as Row[]
      ).map((r) => String(r.id));
      const upd = db.prepare("update job_application set archived_at = ? where id = ?");
      for (const id of ids) upd.run(now.toISOString(), id);
      return ids;
    },
    remove(id) {
      db.prepare("delete from job_application where id = ?").run(id);
    },
    countForPosting(postingId) {
      const r = db
        .prepare("select count(*) as n from job_application where posting_id = ?")
        .get(postingId) as Row;
      return Number(r.n);
    },
    countForDocument(documentId) {
      const r = db
        .prepare(
          `select count(*) as n from job_application a join document_version v
             on v.id = a.cv_version_id or v.id = a.cover_letter_version_id where v.document_id = ?`,
        )
        .get(documentId) as Row;
      return Number(r.n);
    },
  };
}
