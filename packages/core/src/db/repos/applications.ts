import type { ApplicationQuestion, FormField } from "@narnia-jobs/shared";
import { newId } from "../../ids";
import type { Db } from "../open";
import { json, type Row, str } from "../sql";

/** Formulário de candidatura lido pela extensão (F12/M3): campos da página e perguntas organizadas. */
export interface ApplicationFormRecord {
  id: string;
  captureId: string;
  postingId: string | null;
  profileId: string | null;
  url: string;
  title: string | null;
  fields: FormField[];
  questions: ApplicationQuestion[];
  status: "locating" | "ready" | "error";
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationsRepo {
  create(
    input: Pick<
      ApplicationFormRecord,
      "captureId" | "postingId" | "profileId" | "url" | "title" | "fields"
    >,
    now?: Date,
  ): ApplicationFormRecord;
  get(id: string): ApplicationFormRecord | null;
  byCapture(captureId: string): ApplicationFormRecord | null;
  /**
   * Perguntas organizadas: o formulário fica pronto. `warning` (o modelo falhou e as perguntas saíram pelos rótulos)
   * fica em `error`, com o status `ready`.
   */
  setQuestions(
    id: string,
    questions: ApplicationQuestion[],
    warning?: string | null,
    now?: Date,
  ): void;
  setError(id: string, error: string, now?: Date): void;
  /** Pede a organização de novo (Ler de novo). */
  setLocating(id: string, now?: Date): void;
}

function map(r: Row): ApplicationFormRecord {
  return {
    id: String(r.id),
    captureId: String(r.capture_id),
    postingId: str(r.posting_id),
    profileId: str(r.profile_id),
    url: String(r.url),
    title: str(r.title),
    fields: json<FormField[]>(r.fields_json, []),
    questions: json<ApplicationQuestion[]>(r.questions_json, []),
    status: String(r.status) as ApplicationFormRecord["status"],
    error: str(r.error),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function applicationsRepo(db: Db): ApplicationsRepo {
  const get = (id: string) => {
    const r = db.prepare("select * from application_form where id = ?").get(id) as Row | undefined;
    return r ? map(r) : null;
  };
  return {
    create(i, now = new Date()) {
      const id = newId();
      const at = now.toISOString();
      db.prepare(
        `insert into application_form (id, capture_id, posting_id, profile_id, url, title, fields_json, status,
           created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, 'locating', ?, ?)`,
      ).run(
        id,
        i.captureId,
        i.postingId,
        i.profileId,
        i.url,
        i.title,
        JSON.stringify(i.fields),
        at,
        at,
      );
      return get(id) as ApplicationFormRecord;
    },
    get,
    byCapture(captureId) {
      const r = db
        .prepare(
          "select * from application_form where capture_id = ? order by created_at desc limit 1",
        )
        .get(captureId) as Row | undefined;
      return r ? map(r) : null;
    },
    setQuestions(id, questions, warning = null, now = new Date()) {
      db.prepare(
        "update application_form set questions_json = ?, status = 'ready', error = ?, updated_at = ? where id = ?",
      ).run(JSON.stringify(questions), warning, now.toISOString(), id);
    },
    setError(id, error, now = new Date()) {
      db.prepare(
        "update application_form set status = 'error', error = ?, updated_at = ? where id = ?",
      ).run(error, now.toISOString(), id);
    },
    setLocating(id, now = new Date()) {
      db.prepare(
        "update application_form set status = 'locating', error = null, updated_at = ? where id = ?",
      ).run(now.toISOString(), id);
    },
  };
}
