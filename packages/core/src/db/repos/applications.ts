import type {
  AnswersStatus,
  ApplicationAnswer,
  ApplicationQuestion,
  FormField,
} from "@narnia-jobs/shared";
import { type FormStep, mergeStepQuestions } from "../../applications/steps";
import { newId } from "../../ids";
import { type Db, withTransaction } from "../open";
import { json, type Row, str } from "../sql";

/** Formulário de candidatura lido pela extensão (F12/M3): campos da página e perguntas organizadas. */
export interface ApplicationFormRecord {
  id: string;
  captureId: string;
  postingId: string | null;
  profileId: string | null;
  url: string;
  title: string | null;
  /** Campos da etapa 1 (os de antes das etapas); os de cada etapa ficam em `steps`. */
  fields: FormField[];
  questions: ApplicationQuestion[];
  /** Etapas lidas (F12/M6), em ordem; o formulário antigo é a etapa 1. */
  steps: FormStep[];
  /** A etapa da aba: `url` e `title` são os dela, e preencher só vale nela. */
  currentStep: number;
  status: "locating" | "ready" | "error";
  error: string | null;
  /** Geração das respostas (F12/M4). */
  answersStatus: AnswersStatus;
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
  /** Formulários num estado das respostas (F12-23: os que esperam as motivações do perfil). */
  withAnswersStatus(status: AnswersStatus): ApplicationFormRecord[];
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
  /**
   * Perguntas de uma etapa (F12/M6): troca só as dela; o formulário fica pronto quando nenhuma etapa está organizando.
   */
  setStepQuestions(
    id: string,
    step: number,
    questions: ApplicationQuestion[],
    warning?: string | null,
    now?: Date,
  ): void;
  /** Etapa nova lida na aba: vira a atual e fica organizando; devolve o número dela. */
  addStep(
    id: string,
    step: { url: string; title: string | null; fields: FormField[] },
    now?: Date,
  ): number;
  /** A pessoa voltou a uma etapa já lida: ela vira a atual. */
  setCurrentStep(id: string, step: number, now?: Date): void;
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
  const status = String(r.status) as ApplicationFormRecord["status"];
  const saved = json<FormStep[]>(r.steps_json, []);
  const steps: FormStep[] = saved.length
    ? saved
    : [
        {
          n: 1,
          url: String(r.url),
          title: str(r.title),
          fields: json<FormField[]>(r.fields_json, []),
          status,
          createdAt: String(r.created_at),
        },
      ];
  return {
    id: String(r.id),
    captureId: String(r.capture_id),
    postingId: str(r.posting_id),
    profileId: str(r.profile_id),
    url: String(r.url),
    title: str(r.title),
    fields: json<FormField[]>(r.fields_json, []),
    questions: json<ApplicationQuestion[]>(r.questions_json, []),
    steps,
    currentStep: Number(r.current_step ?? 1),
    status,
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
  /** Grava as etapas e o estado do formulário que sai delas (organizando se alguma está; senão, o pedido). */
  const writeSteps = (
    id: string,
    steps: FormStep[],
    set: {
      status?: ApplicationFormRecord["status"];
      error?: string | null;
      questions?: ApplicationQuestion[];
    },
    now: Date,
  ) => {
    const status = steps.some((s) => s.status === "locating")
      ? "locating"
      : (set.status ?? "ready");
    const cols = ["steps_json = ?", "status = ?", "updated_at = ?"];
    const args: Array<string | null> = [JSON.stringify(steps), status, now.toISOString()];
    if (set.error !== undefined) {
      cols.push("error = ?");
      args.push(set.error);
    }
    if (set.questions) {
      cols.push("questions_json = ?");
      args.push(JSON.stringify(set.questions));
    }
    db.prepare(`update application_form set ${cols.join(", ")} where id = ?`).run(...args, id);
  };
  const markAll = (id: string, status: FormStep["status"], error: string | null, now: Date) =>
    withTransaction(db, () => {
      const f = get(id);
      if (!f) return;
      writeSteps(
        id,
        f.steps.map((s) => ({ ...s, status })),
        { status, error },
        now,
      );
    });
  return {
    create(i, now = new Date()) {
      const id = newId();
      const at = now.toISOString();
      const step: FormStep = {
        n: 1,
        url: i.url,
        title: i.title,
        fields: i.fields,
        status: "locating",
        createdAt: at,
      };
      db.prepare(
        `insert into application_form (id, capture_id, posting_id, profile_id, url, title, fields_json, steps_json,
           status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, 'locating', ?, ?)`,
      ).run(
        id,
        i.captureId,
        i.postingId,
        i.profileId,
        i.url,
        i.title,
        JSON.stringify(i.fields),
        JSON.stringify([step]),
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
      withTransaction(db, () => {
        const f = get(id);
        if (!f) return;
        const steps = f.steps.map((s) => ({ ...s, status: "ready" as const }));
        writeSteps(id, steps, { error: warning, questions }, now);
      });
    },
    setStepQuestions(id, step, questions, warning = null, now = new Date()) {
      withTransaction(db, () => {
        const f = get(id);
        if (!f) return;
        const steps = f.steps.map((s) => (s.n === step ? { ...s, status: "ready" as const } : s));
        const merged = mergeStepQuestions(f.questions, step, questions);
        writeSteps(id, steps, { error: warning, questions: merged }, now);
      });
    },
    addStep(id, step, now = new Date()) {
      return withTransaction(db, () => {
        const f = get(id);
        if (!f) throw new Error(`formulário ${id} não encontrado`);
        const n = Math.max(...f.steps.map((s) => s.n)) + 1;
        const steps: FormStep[] = [
          ...f.steps,
          { n, ...step, status: "locating", createdAt: now.toISOString() },
        ];
        writeSteps(id, steps, { error: null }, now);
        db.prepare(
          "update application_form set current_step = ?, url = ?, title = ? where id = ?",
        ).run(n, step.url, step.title, id);
        return n;
      });
    },
    setCurrentStep(id, step, now = new Date()) {
      const s = get(id)?.steps.find((x) => x.n === step);
      if (!s) return;
      db.prepare(
        "update application_form set current_step = ?, url = ?, title = ?, updated_at = ? where id = ?",
      ).run(step, s.url, s.title, now.toISOString(), id);
    },
    setError(id, error, now = new Date()) {
      markAll(id, "error", error, now);
    },
    withAnswersStatus(status) {
      return (
        db
          .prepare("select * from application_form where answers_status = ? order by updated_at")
          .all(status) as Row[]
      ).map(map);
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
      markAll(id, "locating", null, now);
    },
  };
}
