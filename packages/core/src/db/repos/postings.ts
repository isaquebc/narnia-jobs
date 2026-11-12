import {
  type FieldSource,
  type NoteAuthor,
  normalizeLinkedinUrl,
  nowUtc,
  POSTING_FIELD_NAMES,
  POSTING_IDENTITY_FIELDS,
  type Posting,
  type PostingArchiveReason,
  type PostingContact,
  type PostingContactInput,
  PostingContactSchema,
  type PostingCreate,
  type PostingDuplicateCheck,
  type PostingFieldName,
  type PostingNote,
  PostingNoteSchema,
  type PostingPatch,
  PostingSchema,
  type PostingStatus,
} from "@narnia-jobs/shared";
import { newId } from "../../ids";
import { canonicalUrl } from "../../postings/canonical";
import { postingIdentityHash, sameCompany } from "../../postings/identity";
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
  hiringSteps: "hiring_steps_json",
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
  "hiringSteps",
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
    duplicate: "duplicate_json" in r ? json(r.duplicate_json, null) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    contentUpdatedAt: r.content_updated_at ?? r.created_at,
    archivedAt: r.archived_at ?? null,
    archiveReason: r.archive_reason ?? null,
    archiveNote: r.archive_note ?? null,
    source: r.source ?? "manual",
    sourceRef: json(r.source_ref_json, null),
    linkStatus: r.link_status ?? null,
    feedState: r.feed_state ?? null,
    matchScore: r.match_score ?? null,
    matchScoreProvisional: r.match_score_provisional === 1,
    archiveAuto: r.archive_auto ?? null,
    lastInteractionAt: r.last_interaction_at ?? null,
    autoAnalysisAt: r.auto_analysis_at ?? null,
  });
}

export interface PostingsRepo {
  /** Campos informados ganham a origem dada (padrão: usuário). */
  create(input: PostingCreate, opts?: { source?: FieldSource; status?: PostingStatus }): Posting;
  get(id: string): Posting | null;
  /** Mais recentes primeiro. */
  list(opts?: { limit?: number; archived?: boolean }): Posting[];
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
  setDuplicate(id: string, check: PostingDuplicateCheck | null): void;
  /** Arquiva com o motivo (F07: "não deu um bom fit") ou desarquiva (`null`). Não conta como mudança de conteúdo. */
  setArchived(
    id: string,
    archive: { reason: PostingArchiveReason; note: string | null } | null,
    now?: Date,
  ): void;
  remove(id: string): void;
  /** F14 · origem da vaga vinda de e-mail (ou outra) e o estado do link e do feed. */
  setOrigin(
    id: string,
    o: {
      source: Posting["source"];
      sourceRef?: Posting["sourceRef"];
      linkStatus?: Posting["linkStatus"];
      feedState?: Posting["feedState"];
    },
  ): void;
  setLinkStatus(id: string, status: Posting["linkStatus"]): void;
  setFeedState(id: string, state: Posting["feedState"]): void;
  /** Score completo (pela descrição); tira a marca de provisório. */
  setMatchScore(id: string, score: number | null): void;
  /** Score provisório (só pelo alerta, F14-16); não mexe num score completo. */
  setProvisionalScore(id: string, score: number | null): void;
  /** Vagas do e-mail não arquivadas sem score completo (para o provisório). */
  needingProvisionalScore(limit: number): Posting[];
  setCanonicalUrl(id: string, url: string | null): void;
  /** Vagas com o mesmo link canônico (F14: duplicata por SQL, sem o teto de 500 do `list`). */
  findByCanonicalUrl(url: string, excludeId?: string): Posting[];
  /** Vagas da mesma empresa (sem caixa, acento nem sufixo jurídico; correção 2026-11-11), arquivadas inclusive. */
  byCompany(company: string): Posting[];
  /** Interação da pessoa (abrir, editar, analisar, candidatar, nota): a vaga não é arquivada por inatividade. */
  touchInteraction(id: string, at?: string): void;
  setArchiveAuto(id: string, auto: Posting["archiveAuto"], at?: string): void;
  setAutoAnalysisAt(id: string, at: string | null): void;
  /** Feed (F14): vagas vindas de e-mail não arquivadas, pelo match e depois pela data. */
  feed(opts?: { limit?: number }): Posting[];
  /** Vagas do e-mail com link ainda não tentado, das mais antigas (revisão do M4: consulta própria, sem teto do feed). */
  linkPending(limit: number): Posting[];
  /** Pré-análise automática pedida e ainda sem análise gravada (revisão do M4: SQL em vez de reler o feed). */
  autoAnalysisPending(): Posting[];
  /** Quantas pré-análises automáticas foram pedidas desde o instante (todas as vagas, arquivadas inclusive). */
  autoAnalysesSince(iso: string): number;
  /**
   * Arquiva numa só instrução as vagas do e-mail sem interação desde `before` e sem candidatura (F14-9; revisão do M4:
   * atômico, uma interação que chega no meio não é perdida). Devolve os ids.
   */
  archiveStale(before: string, at: string): string[];
}

export function postingsRepo(db: Db): PostingsRepo {
  const q = lazy(db);
  const repo: PostingsRepo = {
    create(input, opts = {}) {
      const id = newId();
      const now = nowUtc();
      const source = opts.source ?? "user";
      const sources: Record<string, FieldSource> = { ...(input.fieldSources ?? {}) };
      const cols = [
        "id",
        "status",
        "identity_hash",
        "created_at",
        "updated_at",
        "content_updated_at",
      ];
      const values: unknown[] = [
        id,
        opts.status ?? "draft",
        postingIdentityHash(input),
        now,
        now,
        now,
      ];
      for (const f of POSTING_FIELD_NAMES) {
        const v = input[f];
        if (v === undefined) continue;
        cols.push(COLUMN[f]);
        values.push(toDb(f, v));
        if (v !== null && !(Array.isArray(v) && v.length === 0)) sources[f] ??= source;
      }
      cols.push("field_sources_json");
      values.push(JSON.stringify(sources));
      if (input.postingUrl) {
        cols.push("canonical_url");
        values.push(canonicalUrl(input.postingUrl));
      }
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
      const where =
        opts.archived === undefined
          ? ""
          : opts.archived
            ? "where archived_at is not null"
            : "where archived_at is null";
      return (
        q(`select * from posting ${where} order by created_at desc, rowid desc limit ?`).all(
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
      if ("postingUrl" in patch) {
        sets.push("canonical_url = ?");
        values.push(patch.postingUrl ? canonicalUrl(patch.postingUrl) : null);
      }
      const now = nowUtc();
      sets.push("field_sources_json = ?", "updated_at = ?");
      values.push(JSON.stringify(sources), now);
      // conteúdo (validade da análise): edição do usuário ou JD nova; o que a extração preenche não conta
      const touched = POSTING_FIELD_NAMES.filter((f) => f in patch && patch[f] !== undefined);
      if (
        touched.includes("jdText") ||
        touched.some((f) => (opts.sources?.[f] ?? opts.source ?? "user") === "user")
      ) {
        sets.push("content_updated_at = ?");
        values.push(now);
      }
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
    setArchived(id, archive, now = new Date()) {
      q(
        "update posting set archived_at = ?, archive_reason = ?, archive_note = ?, archive_auto = null where id = ?",
      ).run(archive ? now.toISOString() : null, archive?.reason ?? null, archive?.note ?? null, id);
    },
    setDuplicate(id, check) {
      q("update posting set duplicate_json = ? where id = ?").run(
        check === null ? null : JSON.stringify(check),
        id,
      );
    },
    remove(id) {
      q("delete from posting where id = ?").run(id);
    },
    setOrigin(id, o) {
      q(
        `update posting set source = ?, source_ref_json = ?, link_status = coalesce(?, link_status),
           feed_state = coalesce(?, feed_state) where id = ?`,
      ).run(
        o.source,
        o.sourceRef ? JSON.stringify(o.sourceRef) : null,
        o.linkStatus ?? null,
        o.feedState ?? null,
        id,
      );
    },
    setLinkStatus(id, status) {
      q("update posting set link_status = ? where id = ?").run(status, id);
    },
    setFeedState(id, state) {
      q("update posting set feed_state = ? where id = ?").run(state, id);
    },
    setMatchScore(id, score) {
      q("update posting set match_score = ?, match_score_provisional = 0 where id = ?").run(
        score,
        id,
      );
    },
    setProvisionalScore(id, score) {
      q(
        "update posting set match_score = ?, match_score_provisional = ? where id = ? and (match_score is null or match_score_provisional = 1)",
      ).run(score, score === null ? 0 : 1, id);
    },
    needingProvisionalScore(limit) {
      return (
        q(
          `select * from posting where source = 'email' and archived_at is null
             and (match_score is null or match_score_provisional = 1) order by created_at desc limit ?`,
        ).all(limit) as Row[]
      ).map(mapPosting);
    },
    setCanonicalUrl(id, url) {
      q("update posting set canonical_url = ? where id = ?").run(url, id);
    },
    findByCanonicalUrl(url, excludeId) {
      return (
        q("select * from posting where canonical_url = ? and id <> ? order by created_at desc").all(
          url,
          excludeId ?? "",
        ) as Row[]
      ).map(mapPosting);
    },
    byCompany(company) {
      return (q("select * from posting where company is not null").all() as Row[])
        .filter((r) => sameCompany(r.company as string, company))
        .map(mapPosting);
    },
    touchInteraction(id, at = nowUtc()) {
      q("update posting set last_interaction_at = ? where id = ?").run(at, id);
    },
    setArchiveAuto(id, auto, at = nowUtc()) {
      q("update posting set archive_auto = ?, archived_at = ? where id = ?").run(
        auto,
        auto ? at : null,
        id,
      );
    },
    setAutoAnalysisAt(id, at) {
      q("update posting set auto_analysis_at = ? where id = ?").run(at, id);
    },
    linkPending(limit) {
      return (
        q(
          `select * from posting where source = 'email' and link_status = 'none' and archived_at is null
           order by created_at limit ?`,
        ).all(limit) as Row[]
      ).map(mapPosting);
    },
    autoAnalysisPending() {
      return (
        q(
          `select * from posting p where p.auto_analysis_at is not null and p.archived_at is null
             and not exists (select 1 from job_analysis a where a.posting_id = p.id)
           order by p.auto_analysis_at`,
        ).all() as Row[]
      ).map(mapPosting);
    },
    autoAnalysesSince(iso) {
      return Number(
        (
          q("select count(*) as n from posting where auto_analysis_at >= ?").get(iso) as {
            n: number;
          }
        ).n,
      );
    },
    archiveStale(before, at) {
      const rows = q(
        `update posting set archive_auto = 'stale', archived_at = ?
         where source = 'email' and archived_at is null
           and coalesce(last_interaction_at, created_at) < ?
           and not exists (select 1 from job_application j where j.posting_id = posting.id)
         returning id`,
      ).all(at, before) as Array<{ id: string }>;
      return rows.map((r) => r.id);
    },
    feed(opts = {}) {
      return (
        q(
          `select * from posting where source = 'email' and archived_at is null
           order by match_score is null, match_score desc, created_at desc limit ?`,
        ).all(opts.limit ?? 500) as Row[]
      ).map(mapPosting);
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
  /** Fixa (soltando o fixado anterior da mesma vaga) ou solta o contato. */
  setPinned(id: string, pinned: boolean): PostingContact;
  /** Outro contato da vaga com o mesmo LinkedIn ou e-mail (`exceptId` = o próprio, na edição). */
  findDuplicate(
    postingId: string,
    input: {
      name: string;
      email?: string | null | undefined;
      linkedinUrl?: string | null | undefined;
    },
    exceptId?: string,
  ): PostingContact | null;
}

function mapContact(r: Row): PostingContact {
  return PostingContactSchema.parse({
    id: r.id,
    postingId: r.posting_id,
    name: r.name,
    origin: r.origin,
    email: r.email ?? null,
    phone: r.phone ?? null,
    linkedinUrl: r.linkedin_url ?? null,
    pinned: Number(r.pinned ?? 0) === 1,
    role: r.role ?? null,
    contactedOn: r.contacted_on ?? null,
    summary: r.summary ?? null,
    referredById: r.referred_by_id ?? null,
    createdAt: r.created_at,
  });
}

export function postingContactsRepo(db: Db): PostingContactsRepo {
  const q = lazy(db);
  // quem indicou precisa ser outro contato da mesma vaga; fora disso, a indicação some
  const referrer = (postingId: string, refId: string | null | undefined, self: string | null) => {
    if (!refId || refId === self) return null;
    const r = q("select posting_id from posting_contact where id = ?").get(refId) as
      | Row
      | undefined;
    return r && r.posting_id === postingId ? refId : null;
  };
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
        `insert into posting_contact (id, posting_id, name, origin, email, phone, linkedin_url, role, contacted_on,
           summary, referred_by_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        postingId,
        i.name,
        i.origin,
        i.email ?? null,
        i.phone ?? null,
        i.linkedinUrl ? (normalizeLinkedinUrl(i.linkedinUrl) ?? null) : null,
        i.role ?? null,
        i.contactedOn ?? null,
        i.summary?.trim() || null,
        referrer(postingId, i.referredById, null),
        nowUtc(),
      );
      return repo.get(id) as PostingContact;
    },
    update(id, p) {
      const cur = repo.get(id);
      if (!cur) throw new Error(`Contato não encontrado: ${id}`);
      q(
        `update posting_contact set name = ?, origin = ?, email = ?, phone = ?, linkedin_url = ?, role = ?,
           contacted_on = ?, summary = ?, referred_by_id = ? where id = ?`,
      ).run(
        p.name ?? cur.name,
        p.origin ?? cur.origin,
        p.email === undefined ? cur.email : p.email,
        p.phone === undefined ? cur.phone : p.phone,
        p.linkedinUrl === undefined
          ? cur.linkedinUrl
          : p.linkedinUrl
            ? (normalizeLinkedinUrl(p.linkedinUrl) ?? null)
            : null,
        p.role === undefined ? cur.role : p.role,
        p.contactedOn === undefined ? cur.contactedOn : p.contactedOn,
        p.summary === undefined ? cur.summary : p.summary?.trim() || null,
        p.referredById === undefined
          ? cur.referredById
          : referrer(cur.postingId, p.referredById, id),
        id,
      );
      return repo.get(id) as PostingContact;
    },
    remove(id) {
      q("delete from posting_contact where id = ?").run(id);
    },
    setPinned(id, pinned) {
      const cur = repo.get(id);
      if (!cur) throw new Error(`Contato não encontrado: ${id}`);
      if (pinned)
        q("update posting_contact set pinned = 0 where posting_id = ? and id <> ?").run(
          cur.postingId,
          id,
        );
      q("update posting_contact set pinned = ? where id = ?").run(pinned ? 1 : 0, id);
      return repo.get(id) as PostingContact;
    },
    findDuplicate(postingId, input, exceptId) {
      const email = input.email?.trim().toLowerCase() || null;
      // o mesmo perfil abre por www., br. ou sem subdomínio: compara o caminho
      const profilePath = (url: string | null | undefined) => {
        const n = url ? normalizeLinkedinUrl(url) : null;
        return n ? new URL(n).pathname.toLowerCase() : null;
      };
      const linkedin = profilePath(input.linkedinUrl);
      if (!email && !linkedin) return null;
      return (
        repo
          .list(postingId)
          .find(
            (c) =>
              c.id !== exceptId &&
              ((email !== null && c.email?.toLowerCase() === email) ||
                (linkedin !== null && profilePath(c.linkedinUrl) === linkedin)),
          ) ?? null
      );
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
