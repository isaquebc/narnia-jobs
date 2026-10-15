import {
  type FieldSource,
  type NoteAuthor,
  nowUtc,
  POSTING_FIELD_NAMES,
  POSTING_IDENTITY_FIELDS,
  type Posting,
  type PostingContact,
  type PostingContactInput,
  PostingContactSchema,
  type PostingCreate,
  type PostingFieldName,
  type PostingNote,
  PostingNoteSchema,
  type PostingPatch,
  PostingSchema,
  type PostingStatus,
} from "@narnia-jobs/shared";
import { newId } from "../../ids";
import { postingIdentityHash } from "../../postings/identity";
import type { Db } from "../open";
import { json, type Row } from "../sql";

/**
 * Repositórios da F06 (§3): vaga, contatos, notas e análises. Consultas preparadas sob demanda (as tabelas só existem
 * a partir da migration 0012; os testes de upgrade montam bancos antigos pelos repositórios de produção).
 */
function lazy(db: Db) {
  const cache = new Map<string, ReturnType<Db["prepare"]>>();
  return (sql: string) => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
}

/** Campo do domínio → coluna (listas em `*_json`). */
const COLUMN: Record<PostingFieldName, string> = {
  company: "company",
  client: "client",
  title: "title",
  role: "role",
  seniority: "seniority",
  city: "city",
  state: "state",
  country: "country",
  workMode: "work_mode",
  contractType: "contract_type",
  currency: "currency",
  salaryMin: "salary_min",
  salaryMax: "salary_max",
  salaryPeriod: "salary_period",
  benefits: "benefits_json",
  responsibilities: "responsibilities_json",
  skillsRequired: "skills_required_json",
  skillsNice: "skills_nice_json",
  companySummary: "company_summary",
  postingUrl: "posting_url",
  companyUrl: "company_url",
  jdText: "jd_text",
  publishedAt: "published_at",
};
const LIST_FIELDS = new Set<PostingFieldName>([
  "benefits",
  "responsibilities",
  "skillsRequired",
  "skillsNice",
]);

const toDb = (field: PostingFieldName, value: unknown) =>
  LIST_FIELDS.has(field) ? JSON.stringify(value ?? []) : (value ?? null);

function mapPosting(r: Row): Posting {
  const fields: Record<string, unknown> = {};
  for (const f of POSTING_FIELD_NAMES) {
    const v = r[COLUMN[f]];
    fields[f] = LIST_FIELDS.has(f) ? json(v, []) : (v ?? null);
  }
  return PostingSchema.parse({
    ...fields,
    id: r.id,
    status: r.status,
    identityHash: r.identity_hash ?? null,
    fieldSources: json(r.field_sources_json, {}),
    preAnalysis: json(r.pre_analysis_json, null),
    rawPath: r.raw_path ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
}

export interface PostingsRepo {
  /** Campos informados ganham a origem dada (padrão: usuário). */
  create(input: PostingCreate, opts?: { source?: FieldSource; status?: PostingStatus }): Posting;
  get(id: string): Posting | null;
  /** Mais recentes primeiro. */
  list(opts?: { limit?: number }): Posting[];
  /** Outras vagas com o mesmo hash de identidade (F06-9). */
  findByIdentity(hash: string, excludeId?: string): Posting[];
  /**
   * Atualiza só os campos presentes no patch; cada um ganha a origem dada (`sources` por campo, ou `source` para todos;
   * padrão usuário). Recalcula a identidade quando empresa, cliente, cargo ou role mudam.
   */
  update(
    id: string,
    patch: PostingPatch,
    opts?: { source?: FieldSource; sources?: Partial<Record<PostingFieldName, FieldSource>> },
  ): Posting;
  setStatus(id: string, status: PostingStatus): void;
  setPreAnalysis(id: string, preAnalysis: unknown): void;
  setRawPath(id: string, path: string | null): void;
  remove(id: string): void;
}

export function postingsRepo(db: Db): PostingsRepo {
  const q = lazy(db);
  const repo: PostingsRepo = {
    create(input, opts = {}) {
      const id = newId();
      const now = nowUtc();
      const source = opts.source ?? "user";
      const sources: Record<string, FieldSource> = { ...(input.fieldSources ?? {}) };
      const cols = ["id", "status", "identity_hash", "created_at", "updated_at"];
      const values: unknown[] = [id, opts.status ?? "draft", postingIdentityHash(input), now, now];
      for (const f of POSTING_FIELD_NAMES) {
        const v = input[f];
        if (v === undefined) continue;
        cols.push(COLUMN[f]);
        values.push(toDb(f, v));
        if (v !== null && !(Array.isArray(v) && v.length === 0)) sources[f] ??= source;
      }
      cols.push("field_sources_json");
      values.push(JSON.stringify(sources));
      db.prepare(
        `insert into posting (${cols.join(", ")}) values (${cols.map(() => "?").join(", ")})`,
      ).run(...(values as never[]));
      return repo.get(id) as Posting;
    },
    get(id) {
      const r = q("select * from posting where id = ?").get(id) as Row | undefined;
      return r ? mapPosting(r) : null;
    },
    list(opts = {}) {
      return (
        q("select * from posting order by created_at desc, rowid desc limit ?").all(
          opts.limit ?? 500,
        ) as Row[]
      ).map(mapPosting);
    },
    findByIdentity(hash, excludeId) {
      return (
        q("select * from posting where identity_hash = ? and id <> ? order by created_at desc").all(
          hash,
          excludeId ?? "",
        ) as Row[]
      ).map(mapPosting);
    },
    update(id, patch, opts = {}) {
      const current = repo.get(id);
      if (!current) throw new Error(`Vaga não encontrada: ${id}`);
      const sets: string[] = [];
      const values: unknown[] = [];
      const sources = { ...current.fieldSources };
      for (const f of POSTING_FIELD_NAMES) {
        if (!(f in patch)) continue;
        const v = patch[f];
        if (v === undefined) continue;
        sets.push(`${COLUMN[f]} = ?`);
        values.push(toDb(f, v));
        const empty = v === null || (Array.isArray(v) && v.length === 0);
        if (empty) delete sources[f];
        else sources[f] = opts.sources?.[f] ?? opts.source ?? "user";
      }
      if (sets.length === 0) return current;
      const next = { ...current, ...patch };
      if (POSTING_IDENTITY_FIELDS.some((f) => f in patch)) {
        sets.push("identity_hash = ?");
        values.push(postingIdentityHash(next));
      }
      sets.push("field_sources_json = ?", "updated_at = ?");
      values.push(JSON.stringify(sources), nowUtc());
      db.prepare(`update posting set ${sets.join(", ")} where id = ?`).run(
        ...(values as never[]),
        id,
      );
      return repo.get(id) as Posting;
    },
    setStatus(id, status) {
      q("update posting set status = ?, updated_at = ? where id = ?").run(status, nowUtc(), id);
    },
    setPreAnalysis(id, preAnalysis) {
      q("update posting set pre_analysis_json = ? where id = ?").run(
        preAnalysis === null ? null : JSON.stringify(preAnalysis),
        id,
      );
    },
    setRawPath(id, path) {
      q("update posting set raw_path = ? where id = ?").run(path, id);
    },
    remove(id) {
      q("delete from posting where id = ?").run(id);
    },
  };
  return repo;
}

/* ---------- contatos ---------- */

export interface PostingContactsRepo {
  list(postingId: string): PostingContact[];
  get(id: string): PostingContact | null;
  add(postingId: string, input: PostingContactInput): PostingContact;
  update(
    id: string,
    patch: { [K in keyof PostingContactInput]?: PostingContactInput[K] | undefined },
  ): PostingContact;
  remove(id: string): void;
}

function mapContact(r: Row): PostingContact {
  return PostingContactSchema.parse({
    id: r.id,
    postingId: r.posting_id,
    name: r.name,
    origin: r.origin,
    email: r.email ?? null,
    phone: r.phone ?? null,
    createdAt: r.created_at,
  });
}

export function postingContactsRepo(db: Db): PostingContactsRepo {
  const q = lazy(db);
  const repo: PostingContactsRepo = {
    list: (postingId) =>
      (
        q("select * from posting_contact where posting_id = ? order by created_at, rowid").all(
          postingId,
        ) as Row[]
      ).map(mapContact),
    get(id) {
      const r = q("select * from posting_contact where id = ?").get(id) as Row | undefined;
      return r ? mapContact(r) : null;
    },
    add(postingId, i) {
      const id = newId();
      q(
        `insert into posting_contact (id, posting_id, name, origin, email, phone, created_at)
         values (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, postingId, i.name, i.origin, i.email ?? null, i.phone ?? null, nowUtc());
      return repo.get(id) as PostingContact;
    },
    update(id, p) {
      const cur = repo.get(id);
      if (!cur) throw new Error(`Contato não encontrado: ${id}`);
      q("update posting_contact set name = ?, origin = ?, email = ?, phone = ? where id = ?").run(
        p.name ?? cur.name,
        p.origin ?? cur.origin,
        p.email === undefined ? cur.email : p.email,
        p.phone === undefined ? cur.phone : p.phone,
        id,
      );
      return repo.get(id) as PostingContact;
    },
    remove(id) {
      q("delete from posting_contact where id = ?").run(id);
    },
  };
  return repo;
}

/* ---------- notas ---------- */

export interface PostingNotesRepo {
  list(postingId: string): PostingNote[];
  get(id: string): PostingNote | null;
  add(postingId: string, author: NoteAuthor, body: string): PostingNote;
  /**
   * Edita a nota. O recrutador editando nota do usuário não altera o texto: grava `pendingBody` e devolve
   * `pending: true` (F06-17). Qualquer outra combinação altera direto (e descarta pendência antiga).
   */
  edit(id: string, by: NoteAuthor, body: string): { note: PostingNote; pending: boolean };
  /** Confirma a edição pendente: o texto proposto passa a valer. */
  confirm(id: string): PostingNote;
  /** Recusa a edição pendente: o texto do usuário continua. */
  reject(id: string): PostingNote;
  /** Notas com edição do recrutador esperando o usuário (bandeja "Aguardando você"). */
  listPending(): PostingNote[];
  remove(id: string): void;
}

function mapNote(r: Row): PostingNote {
  return PostingNoteSchema.parse({
    id: r.id,
    postingId: r.posting_id,
    author: r.author,
    body: r.body,
    pendingBody: r.pending_body ?? null,
    pendingAt: r.pending_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
}

export function postingNotesRepo(db: Db): PostingNotesRepo {
  const q = lazy(db);
  const must = (id: string) => {
    const n = repo.get(id);
    if (!n) throw new Error(`Nota não encontrada: ${id}`);
    return n;
  };
  const repo: PostingNotesRepo = {
    list: (postingId) =>
      (
        q("select * from posting_note where posting_id = ? order by created_at, rowid").all(
          postingId,
        ) as Row[]
      ).map(mapNote),
    get(id) {
      const r = q("select * from posting_note where id = ?").get(id) as Row | undefined;
      return r ? mapNote(r) : null;
    },
    add(postingId, author, body) {
      const id = newId();
      const now = nowUtc();
      q(
        `insert into posting_note (id, posting_id, author, body, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?)`,
      ).run(id, postingId, author, body, now, now);
      return must(id);
    },
    edit(id, by, body) {
      const cur = must(id);
      const now = nowUtc();
      if (cur.author === "user" && by === "recruiter") {
        q("update posting_note set pending_body = ?, pending_at = ? where id = ?").run(
          body,
          now,
          id,
        );
        return { note: must(id), pending: true };
      }
      q(
        "update posting_note set body = ?, pending_body = null, pending_at = null, updated_at = ? where id = ?",
      ).run(body, now, id);
      return { note: must(id), pending: false };
    },
    confirm(id) {
      const cur = must(id);
      if (cur.pendingBody === null) return cur;
      q(
        "update posting_note set body = pending_body, pending_body = null, pending_at = null, updated_at = ? where id = ?",
      ).run(nowUtc(), id);
      return must(id);
    },
    reject(id) {
      must(id);
      q("update posting_note set pending_body = null, pending_at = null where id = ?").run(id);
      return must(id);
    },
    listPending: () =>
      (
        q(
          "select * from posting_note where pending_body is not null order by pending_at desc",
        ).all() as Row[]
      ).map(mapNote),
    remove(id) {
      q("delete from posting_note where id = ?").run(id);
    },
  };
  return repo;
}

/* ---------- análises ---------- */

export interface JobAnalysisRecord {
  id: string;
  postingId: string;
  analysis: unknown;
  recommendedProfileId: string | null;
  factsVersion: number;
  postingUpdatedAt: string;
  models: string[];
  usage: unknown;
  chatSessionId: string | null;
  createdAt: string;
}

export interface JobAnalysesRepo {
  add(input: Omit<JobAnalysisRecord, "id" | "createdAt">): JobAnalysisRecord;
  get(id: string): JobAnalysisRecord | null;
  /** Mais recente primeiro (a primeira é a atual, F06-10). */
  list(postingId: string): JobAnalysisRecord[];
  latest(postingId: string): JobAnalysisRecord | null;
}

function mapAnalysis(r: Row): JobAnalysisRecord {
  return {
    id: String(r.id),
    postingId: String(r.posting_id),
    analysis: json(r.analysis_json, null),
    recommendedProfileId: (r.recommended_profile_id as string | null) ?? null,
    factsVersion: Number(r.facts_version),
    postingUpdatedAt: String(r.posting_updated_at),
    models: json(r.models_json, []),
    usage: json(r.usage_json, null),
    chatSessionId: (r.chat_session_id as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

export function jobAnalysesRepo(db: Db): JobAnalysesRepo {
  const q = lazy(db);
  const repo: JobAnalysesRepo = {
    add(i) {
      const id = newId();
      q(
        `insert into job_analysis (id, posting_id, analysis_json, recommended_profile_id, facts_version,
           posting_updated_at, models_json, usage_json, chat_session_id, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        i.postingId,
        JSON.stringify(i.analysis),
        i.recommendedProfileId,
        i.factsVersion,
        i.postingUpdatedAt,
        JSON.stringify(i.models),
        i.usage === null || i.usage === undefined ? null : JSON.stringify(i.usage),
        i.chatSessionId,
        nowUtc(),
      );
      return repo.get(id) as JobAnalysisRecord;
    },
    get(id) {
      const r = q("select * from job_analysis where id = ?").get(id) as Row | undefined;
      return r ? mapAnalysis(r) : null;
    },
    list: (postingId) =>
      (
        q(
          "select * from job_analysis where posting_id = ? order by created_at desc, rowid desc",
        ).all(postingId) as Row[]
      ).map(mapAnalysis),
    latest: (postingId) => repo.list(postingId)[0] ?? null,
  };
  return repo;
}
