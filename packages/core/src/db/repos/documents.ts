import {
  type CoverLetterFormat,
  type CvLocale,
  type CvReview,
  type DocumentKind,
  nowUtc,
  type Paper,
} from "@narnia-jobs/shared";
import { newId } from "../../ids";
import type { Db } from "../open";
import { json, num, type Row, str } from "../sql";

/**
 * Repositórios da F05 (§3): documento (CV ou carta) por perfil e, opcionalmente, vaga; versões com o conteúdo, o
 * estado do ciclo gerar → montar → conferir → revisar e os dados de validade; templates enviados pela pessoa.
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

export const DOCUMENT_VERSION_STATUSES = [
  "queued",
  "collecting",
  "generating",
  "validating",
  "rendering",
  "checking",
  "reviewing",
  "retrying",
  "ready",
  "ready_with_issues",
  "error",
] as const;
export type DocumentVersionStatus = (typeof DOCUMENT_VERSION_STATUSES)[number];
export type DocumentVersionSource = "agent" | "edit" | "recruiter" | "template";

export interface DocumentRecord {
  id: string;
  kind: DocumentKind;
  profileId: string;
  postingId: string | null;
  templateId: string;
  paper: Paper;
  locale: CvLocale;
  format: CoverLetterFormat;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentVersionRecord {
  id: string;
  documentId: string;
  version: number;
  source: DocumentVersionSource;
  instructions: string | null;
  templateId: string;
  locale: CvLocale;
  paper: Paper;
  format: CoverLetterFormat;
  content: unknown;
  status: DocumentVersionStatus;
  attempts: number;
  review: CvReview | null;
  atsScore: number | null;
  pagesRendered: number | null;
  pdfPath: string | null;
  textBody: string | null;
  factsVersion: number;
  postingUpdatedAt: string | null;
  profileHash: string;
  jobId: string | null;
  usage: unknown[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DocumentCreate = Pick<
  DocumentRecord,
  "kind" | "profileId" | "postingId" | "templateId" | "paper" | "locale" | "format"
>;
export type VersionCreate = Pick<
  DocumentVersionRecord,
  "source" | "instructions" | "factsVersion" | "postingUpdatedAt" | "profileHash"
> &
  Partial<Pick<DocumentVersionRecord, "content" | "templateId" | "locale" | "paper" | "format">>;
export type VersionPatch = Partial<
  Pick<
    DocumentVersionRecord,
    | "status"
    | "attempts"
    | "content"
    | "review"
    | "atsScore"
    | "pagesRendered"
    | "pdfPath"
    | "textBody"
    | "jobId"
    | "usage"
    | "error"
  >
>;

export interface DocumentsRepo {
  create(input: DocumentCreate): DocumentRecord;
  get(id: string): DocumentRecord | null;
  find(kind: DocumentKind, profileId: string, postingId: string | null): DocumentRecord | null;
  list(filter: { profileId?: string; postingId?: string; kind?: DocumentKind }): DocumentRecord[];
  update(
    id: string,
    patch: Partial<Pick<DocumentRecord, "templateId" | "paper" | "locale" | "format">>,
  ): DocumentRecord;
  remove(id: string): void;
  /** Nova versão (número seguinte), já como a atual do documento; herda template, idioma, papel e formato. */
  addVersion(documentId: string, input: VersionCreate): DocumentVersionRecord;
  getVersion(documentId: string, version: number): DocumentVersionRecord | null;
  /** Volta uma versão já existente a ser a atual (troca de modelo para um já montado). */
  setCurrent(documentId: string, version: number): DocumentRecord;
  versionById(id: string): DocumentVersionRecord | null;
  currentVersion(documentId: string): DocumentVersionRecord | null;
  /** Mais recente primeiro. */
  listVersions(documentId: string): DocumentVersionRecord[];
  /** Versões ainda em andamento (de todos os documentos), para o verificador de presas. */
  listActiveVersions(): DocumentVersionRecord[];
  updateVersion(id: string, patch: VersionPatch): DocumentVersionRecord;
}

function mapDocument(r: Row): DocumentRecord {
  return {
    id: String(r.id),
    kind: r.kind as DocumentKind,
    profileId: String(r.profile_id),
    postingId: str(r.posting_id),
    templateId: String(r.template_id),
    paper: r.paper as Paper,
    locale: r.locale as CvLocale,
    format: r.format as CoverLetterFormat,
    currentVersion: Number(r.current_version),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function mapVersion(r: Row): DocumentVersionRecord {
  return {
    id: String(r.id),
    documentId: String(r.document_id),
    version: Number(r.version),
    source: r.source as DocumentVersionSource,
    instructions: str(r.instructions),
    templateId: String(r.template_id),
    locale: r.locale as CvLocale,
    paper: r.paper as Paper,
    format: r.format as CoverLetterFormat,
    content: json(r.content_json, null),
    status: r.status as DocumentVersionStatus,
    attempts: Number(r.attempts),
    review: json<CvReview | null>(r.review_json, null),
    atsScore: num(r.ats_score),
    pagesRendered: num(r.pages_rendered),
    pdfPath: str(r.pdf_path),
    textBody: str(r.text_body),
    factsVersion: Number(r.facts_version),
    postingUpdatedAt: str(r.posting_updated_at),
    profileHash: String(r.profile_hash),
    jobId: str(r.job_id),
    usage: json<unknown[]>(r.usage_json, []),
    error: str(r.error),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

const VERSION_COLUMNS: Record<keyof VersionPatch, [string, (v: unknown) => unknown]> = {
  status: ["status", (v) => v],
  attempts: ["attempts", (v) => v],
  content: ["content_json", (v) => (v === null ? null : JSON.stringify(v))],
  review: ["review_json", (v) => (v === null ? null : JSON.stringify(v))],
  atsScore: ["ats_score", (v) => v],
  pagesRendered: ["pages_rendered", (v) => v],
  pdfPath: ["pdf_path", (v) => v],
  textBody: ["text_body", (v) => v],
  jobId: ["job_id", (v) => v],
  usage: ["usage_json", (v) => JSON.stringify(v ?? [])],
  error: ["error", (v) => v],
};

export function documentsRepo(db: Db): DocumentsRepo {
  const q = lazy(db);
  const must = (id: string) => {
    const d = repo.get(id);
    if (!d) throw new Error(`documento ${id} não existe`);
    return d;
  };
  const repo: DocumentsRepo = {
    create(i) {
      const id = newId();
      const now = nowUtc();
      q(
        `insert into document (id, kind, profile_id, posting_id, template_id, paper, locale, format, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        i.kind,
        i.profileId,
        i.postingId,
        i.templateId,
        i.paper,
        i.locale,
        i.format,
        now,
        now,
      );
      return must(id);
    },
    get(id) {
      const r = q("select * from document where id = ?").get(id) as Row | undefined;
      return r ? mapDocument(r) : null;
    },
    find(kind, profileId, postingId) {
      const r = (
        postingId === null
          ? q(
              "select * from document where kind = ? and profile_id = ? and posting_id is null",
            ).get(kind, profileId)
          : q("select * from document where kind = ? and profile_id = ? and posting_id = ?").get(
              kind,
              profileId,
              postingId,
            )
      ) as Row | undefined;
      return r ? mapDocument(r) : null;
    },
    list(f) {
      const where: string[] = [];
      const args: string[] = [];
      if (f.profileId) {
        where.push("profile_id = ?");
        args.push(f.profileId);
      }
      if (f.postingId) {
        where.push("posting_id = ?");
        args.push(f.postingId);
      }
      if (f.kind) {
        where.push("kind = ?");
        args.push(f.kind);
      }
      const sql = `select * from document ${where.length ? `where ${where.join(" and ")}` : ""} order by updated_at desc, rowid desc`;
      return (db.prepare(sql).all(...args) as Row[]).map(mapDocument);
    },
    update(id, patch) {
      const cur = must(id);
      const next = { ...cur, ...patch };
      q(
        "update document set template_id = ?, paper = ?, locale = ?, format = ?, updated_at = ? where id = ?",
      ).run(next.templateId, next.paper, next.locale, next.format, nowUtc(), id);
      return must(id);
    },
    remove(id) {
      q("delete from document where id = ?").run(id);
    },
    addVersion(documentId, i) {
      const doc = must(documentId);
      const id = newId();
      const now = nowUtc();
      // pela maior versão, não pela atual: a atual pode ter voltado a uma anterior (setCurrent)
      const max = q("select max(version) as m from document_version where document_id = ?").get(
        documentId,
      ) as Row | undefined;
      const version = Math.max(doc.currentVersion, Number(max?.m ?? 0)) + 1;
      db.exec("begin");
      try {
        q(
          `insert into document_version (id, document_id, version, source, instructions, template_id, locale, paper,
             format, content_json, facts_version, posting_updated_at, profile_hash, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          documentId,
          version,
          i.source,
          i.instructions,
          i.templateId ?? doc.templateId,
          i.locale ?? doc.locale,
          i.paper ?? doc.paper,
          i.format ?? doc.format,
          i.content === undefined || i.content === null ? null : JSON.stringify(i.content),
          i.factsVersion,
          i.postingUpdatedAt,
          i.profileHash,
          now,
          now,
        );
        q("update document set current_version = ?, updated_at = ? where id = ?").run(
          version,
          now,
          documentId,
        );
        db.exec("commit");
      } catch (e) {
        db.exec("rollback");
        throw e;
      }
      return repo.versionById(id) as DocumentVersionRecord;
    },
    getVersion(documentId, version) {
      const r = q("select * from document_version where document_id = ? and version = ?").get(
        documentId,
        version,
      ) as Row | undefined;
      return r ? mapVersion(r) : null;
    },
    setCurrent(documentId, version) {
      if (!repo.getVersion(documentId, version))
        throw new Error(`versão ${version} do documento ${documentId} não existe`);
      q("update document set current_version = ?, updated_at = ? where id = ?").run(
        version,
        nowUtc(),
        documentId,
      );
      return must(documentId);
    },
    versionById(id) {
      const r = q("select * from document_version where id = ?").get(id) as Row | undefined;
      return r ? mapVersion(r) : null;
    },
    currentVersion(documentId) {
      const doc = repo.get(documentId);
      return doc && doc.currentVersion > 0 ? repo.getVersion(documentId, doc.currentVersion) : null;
    },
    listVersions(documentId) {
      return (
        q("select * from document_version where document_id = ? order by version desc").all(
          documentId,
        ) as Row[]
      ).map(mapVersion);
    },
    listActiveVersions() {
      const done = ["ready", "ready_with_issues", "error"];
      return (
        q(
          `select * from document_version where status not in (${done.map(() => "?").join(", ")}) order by created_at`,
        ).all(...done) as Row[]
      ).map(mapVersion);
    },
    updateVersion(id, patch) {
      const sets: string[] = [];
      const args: unknown[] = [];
      for (const [k, v] of Object.entries(patch) as [keyof VersionPatch, unknown][]) {
        if (v === undefined) continue;
        const [col, enc] = VERSION_COLUMNS[k];
        sets.push(`${col} = ?`);
        args.push(enc(v));
      }
      sets.push("updated_at = ?");
      args.push(nowUtc(), id);
      db.prepare(`update document_version set ${sets.join(", ")} where id = ?`).run(
        ...(args as never[]),
      );
      const v = repo.versionById(id);
      if (!v) throw new Error(`versão ${id} não existe`);
      return v;
    },
  };
  return repo;
}

/* ---------- templates do usuário ---------- */

export interface CvTemplateRecord {
  id: string;
  name: string;
  engine: "handlebars";
  path: string;
  manifest: Record<string, unknown>;
  previewPath: string | null;
  status: "validating" | "valid" | "invalid";
  validationErrors: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CvTemplatesRepo {
  create(input: Pick<CvTemplateRecord, "name" | "engine" | "path" | "manifest">): CvTemplateRecord;
  get(id: string): CvTemplateRecord | null;
  list(): CvTemplateRecord[];
  update(
    id: string,
    patch: Partial<
      Pick<CvTemplateRecord, "name" | "manifest" | "previewPath" | "status" | "validationErrors">
    >,
  ): CvTemplateRecord;
  remove(id: string): void;
}

function mapTemplate(r: Row): CvTemplateRecord {
  return {
    id: String(r.id),
    name: String(r.name),
    engine: "handlebars",
    path: String(r.path),
    manifest: json(r.manifest_json, {}),
    previewPath: str(r.preview_path),
    status: r.status as CvTemplateRecord["status"],
    validationErrors: json<string[]>(r.validation_errors_json, []),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function cvTemplatesRepo(db: Db): CvTemplatesRepo {
  const q = lazy(db);
  const repo: CvTemplatesRepo = {
    create(i) {
      const id = newId();
      const now = nowUtc();
      q(
        `insert into cv_template (id, name, engine, path, manifest_json, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, i.name, i.engine, i.path, JSON.stringify(i.manifest), now, now);
      return repo.get(id) as CvTemplateRecord;
    },
    get(id) {
      const r = q("select * from cv_template where id = ?").get(id) as Row | undefined;
      return r ? mapTemplate(r) : null;
    },
    list: () =>
      (q("select * from cv_template order by created_at desc, rowid desc").all() as Row[]).map(
        mapTemplate,
      ),
    update(id, patch) {
      const cur = repo.get(id);
      if (!cur) throw new Error(`template ${id} não existe`);
      const n = { ...cur, ...patch };
      q(
        `update cv_template set name = ?, manifest_json = ?, preview_path = ?, status = ?, validation_errors_json = ?,
           updated_at = ? where id = ?`,
      ).run(
        n.name,
        JSON.stringify(n.manifest),
        n.previewPath,
        n.status,
        JSON.stringify(n.validationErrors),
        nowUtc(),
        id,
      );
      return repo.get(id) as CvTemplateRecord;
    },
    remove(id) {
      q("delete from cv_template where id = ?").run(id);
    },
  };
  return repo;
}
