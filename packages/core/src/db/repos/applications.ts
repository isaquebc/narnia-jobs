import type { ApplicationAnswer, ApplicationQuestion, FormField } from "@narnia-jobs/shared";
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
  /** Geração das respostas (F12/M4). */
  answersStatus: "idle" | "answering" | "ready" | "error";
  answersError: string | null;
  /** Conversa do formulário com o recrutador (F12/M5), criada na primeira mensagem. */
  chatSessionId: string | null;
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
  /** Os mais recentes primeiro (modo B: achar o formulário pela conversa no terminal). */
  listRecent(limit: number): ApplicationFormRecord[];
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
  /** Liga (ou desliga) o formulário a uma vaga salva, escolhida na janela. */
  setPosting(id: string, postingId: string | null, now?: Date): void;
  setAnswersStatus(
    id: string,
    status: ApplicationFormRecord["answersStatus"],
    error?: string | null,
    now?: Date,
  ): void;
  /** Grava uma versão nova de cada resposta (a anterior fica no histórico). */
  addAnswers(
    formId: string,
    answers: Array<Omit<ApplicationAnswer, "version" | "createdAt">>,
    now?: Date,
  ): void;
  /** A versão mais nova de cada pergunta. */
  latestAnswers(formId: string): ApplicationAnswer[];
  /**
   * Textos que a pessoa escreveu ao editar respostas de outros formulários (F12-18): o roleplay imita a escrita dela.
   * Só os longos (frases, não "Sim"), os mais novos primeiro.
   */
  editedTexts(opts: { excludeFormId: string; limit: number }): string[];
  setChatSession(id: string, sessionId: string, now?: Date): void;
  /** Pede a organização de novo (Ler de novo). */
  setLocating(id: string, now?: Date): void;
}

/** Abaixo disso a edição não mostra jeito de escrever ("Sim", um número, uma cidade). */
const MIN_SAMPLE_CHARS = 60;

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
    answersStatus: (str(r.answers_status) ?? "idle") as ApplicationFormRecord["answersStatus"],
    answersError: str(r.answers_error),
    chatSessionId: str(r.chat_session_id),
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
    listRecent(limit) {
      return (
        db
          .prepare("select * from application_form order by updated_at desc, id desc limit ?")
          .all(limit) as Row[]
      ).map(map);
    },
    setChatSession(id, sessionId, now = new Date()) {
      db.prepare(
        "update application_form set chat_session_id = ?, updated_at = ? where id = ?",
      ).run(sessionId, now.toISOString(), id);
    },
    setPosting(id, postingId, now = new Date()) {
      db.prepare("update application_form set posting_id = ?, updated_at = ? where id = ?").run(
        postingId,
        now.toISOString(),
        id,
      );
    },
    setAnswersStatus(id, status, error = null, now = new Date()) {
      db.prepare(
        "update application_form set answers_status = ?, answers_error = ?, updated_at = ? where id = ?",
      ).run(status, error, now.toISOString(), id);
    },
    addAnswers(formId, answers, now = new Date()) {
      const next = db.prepare(
        "select coalesce(max(version), 0) + 1 as v from application_answer where form_id = ? and question_id = ?",
      );
      const insert = db.prepare(
        `insert into application_answer
           (id, form_id, question_id, version, answer, origins_json, gap, assumptions_json, source, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const a of answers) {
        const v = Number((next.get(formId, a.questionId) as Row).v);
        insert.run(
          newId(),
          formId,
          a.questionId,
          v,
          a.answer,
          JSON.stringify(a.origins),
          a.gap,
          JSON.stringify(a.assumptions),
          a.source,
          now.toISOString(),
        );
      }
    },
    latestAnswers(formId) {
      const rows = db
        .prepare(
          `select a.* from application_answer a
           where a.form_id = ? and a.version = (select max(b.version) from application_answer b
             where b.form_id = a.form_id and b.question_id = a.question_id)
           order by a.question_id`,
        )
        .all(formId) as Row[];
      return rows.map((r) => ({
        questionId: String(r.question_id),
        version: Number(r.version),
        answer: str(r.answer),
        origins: json<Array<{ kind: string; id: string }>>(r.origins_json, []),
        gap: str(r.gap),
        assumptions: json<string[]>(r.assumptions_json, []),
        source: String(r.source) as ApplicationAnswer["source"],
        createdAt: String(r.created_at),
      }));
    },
    editedTexts({ excludeFormId, limit }) {
      const rows = db
        .prepare(
          `select answer from application_answer
           where source = 'edited' and form_id != ? and length(answer) >= ?
           order by created_at desc, version desc limit ?`,
        )
        .all(excludeFormId, MIN_SAMPLE_CHARS, limit) as Row[];
      return rows.map((r) => String(r.answer));
    },
    setLocating(id, now = new Date()) {
      db.prepare(
        "update application_form set status = 'locating', error = null, updated_at = ? where id = ?",
      ).run(now.toISOString(), id);
    },
  };
}
