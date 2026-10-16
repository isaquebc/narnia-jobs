import type { CoverLetterFormat, CvLinkKind, DocumentKind, Paper } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import type {
  DocumentRecord,
  DocumentVersionRecord,
  DocumentVersionSource,
} from "../db/repos/documents";
import { documentLocale, languageCoverage, profileHash } from "./brief";
import { buildCvHeader } from "./header";
import { missingHeaderLinks } from "./links";
import { DOCUMENT_TASKS } from "./tasks";

/**
 * Pedido de CV ou carta (F05 §2.1), o mesmo caminho para o botão, o "Atualizar" e o recrutador (F05-11): resolve o
 * idioma (vaga › perfil, F05-16), confere se o currículo cobre o idioma (senão a pessoa decide: `acceptLanguage`), cria
 * o documento por (tipo, perfil, vaga) na primeira vez, abre uma versão nova e enfileira `cv.generate`. Uma geração em
 * andamento do mesmo documento é devolvida em vez de duplicada.
 */
export type DocumentRequestCode =
  | "profile_not_found"
  | "posting_not_found"
  | "posting_required"
  | "language_not_covered"
  | "document_not_found";

export class DocumentRequestError extends Error {
  constructor(
    readonly code: DocumentRequestCode,
    message: string,
    readonly language: string | null = null,
  ) {
    super(message);
    this.name = "DocumentRequestError";
  }
}

export type EnqueueDocumentTask = (req: {
  queue: "extract";
  type: string;
  key: string;
  payload: Record<string, unknown>;
  profileId?: string | null;
}) => Promise<unknown>;

export interface RequestDocumentInput {
  kind: DocumentKind;
  profileId: string;
  postingId: string | null;
  instructions?: string | null | undefined;
  acceptLanguage?: boolean | undefined;
  templateId?: string | undefined;
  format?: CoverLetterFormat | undefined;
  source?: DocumentVersionSource | undefined;
  /** "Tentar de novo": o gerador já começa com os erros da revisão da versão atual (como na regeração automática). */
  fixIssues?: boolean | undefined;
}

const LETTER_MARKETS = new Set(["US", "CA"]);
const ACTIVE = new Set([
  "queued",
  "collecting",
  "generating",
  "validating",
  "rendering",
  "checking",
  "reviewing",
  "retrying",
]);

export const isVersionActive = (v: Pick<DocumentVersionRecord, "status">) => ACTIVE.has(v.status);

export async function requestDocument(
  repos: Repos,
  enqueue: EnqueueDocumentTask,
  input: RequestDocumentInput,
): Promise<{ document: DocumentRecord; version: DocumentVersionRecord; created: boolean }> {
  const profile = repos.profiles.get(input.profileId);
  if (!profile) throw new DocumentRequestError("profile_not_found", "Perfil não encontrado.");
  const posting = input.postingId ? repos.postings.get(input.postingId) : null;
  if (input.postingId && !posting)
    throw new DocumentRequestError("posting_not_found", "Vaga não encontrada.");
  if (input.kind === "cover_letter" && !posting)
    throw new DocumentRequestError(
      "posting_required",
      "A carta de apresentação é feita para uma vaga.",
    );

  let doc = repos.documents.find(input.kind, profile.id, posting?.id ?? null);
  const previousIssues =
    input.fixIssues && doc
      ? (repos.documents.currentVersion(doc.id)?.review?.issues ?? [])
          .filter((i) => i.severity === "error")
          .map(({ area, message, where }) => ({ area, message, where: where ?? null }))
      : [];
  const locale = documentLocale(profile, posting);
  if (!input.acceptLanguage) {
    const cover = languageCoverage(
      repos.facts.languages.list(),
      { country: repos.users.get()?.country ?? null },
      locale,
    );
    if (!cover.covered)
      throw new DocumentRequestError(
        "language_not_covered",
        `A vaga é em ${cover.language.toLowerCase()}, e o seu currículo não mostra ${cover.language.toLowerCase()} fluente. Gerar mesmo assim?`,
        cover.language,
      );
  }
  const created = !doc;
  if (!doc)
    doc = repos.documents.create({
      kind: input.kind,
      profileId: profile.id,
      postingId: posting?.id ?? null,
      templateId: input.templateId ?? "classico",
      paper: (LETTER_MARKETS.has(profile.market.toUpperCase()) ? "Letter" : "A4") as Paper,
      locale,
      format: input.format ?? "pdf",
    });
  else {
    const current = repos.documents.currentVersion(doc.id);
    if (current && isVersionActive(current))
      return { document: doc, version: current, created: false };
    doc = repos.documents.update(doc.id, {
      locale,
      ...(input.templateId ? { templateId: input.templateId } : {}),
      ...(input.format ? { format: input.format } : {}),
    });
  }
  const version = repos.documents.addVersion(doc.id, {
    source: input.source ?? "agent",
    instructions: input.instructions?.trim() || null,
    factsVersion: repos.settings.getFactsVersion(),
    postingUpdatedAt: posting?.contentUpdatedAt ?? null,
    profileHash: profileHash(profile, repos.emphasis.list(profile.id)),
  });
  await enqueue({
    queue: "extract",
    type: DOCUMENT_TASKS.generate,
    key: doc.id,
    payload: {
      documentId: doc.id,
      versionId: version.id,
      ...(previousIssues.length ? { previousIssues } : {}),
    },
    profileId: profile.id,
  });
  return { document: repos.documents.get(doc.id) as DocumentRecord, version, created };
}

/** Validade (F05-18): fatos, perfil (campos e ênfases) e vaga mudaram depois desta versão? */
export function documentStale(
  repos: Repos,
  doc: DocumentRecord,
  version: DocumentVersionRecord,
): { facts: boolean; profile: boolean; posting: boolean } {
  const profile = repos.profiles.get(doc.profileId);
  const posting = doc.postingId ? repos.postings.get(doc.postingId) : null;
  return {
    facts: repos.settings.getFactsVersion() > version.factsVersion,
    profile: profile
      ? profileHash(profile, repos.emphasis.list(profile.id)) !== version.profileHash
      : false,
    posting: Boolean(
      posting && version.postingUpdatedAt && posting.contentUpdatedAt > version.postingUpdatedAt,
    ),
  };
}

export interface DocumentView {
  document: DocumentRecord;
  current: DocumentVersionRecord | null;
  versions: Array<
    Pick<
      DocumentVersionRecord,
      "id" | "version" | "status" | "source" | "atsScore" | "pagesRendered" | "createdAt"
    > & {
      passed: boolean | null;
    }
  >;
  stale: { facts: boolean; profile: boolean; posting: boolean } | null;
  missingLinks: CvLinkKind[];
}

export function documentView(repos: Repos, doc: DocumentRecord): DocumentView {
  const versions = repos.documents.listVersions(doc.id);
  const current = versions.find((v) => v.version === doc.currentVersion) ?? null;
  const header = buildCvHeader(repos, doc.profileId, doc.locale);
  return {
    document: doc,
    current,
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      status: v.status,
      source: v.source,
      atsScore: v.atsScore,
      pagesRendered: v.pagesRendered,
      createdAt: v.createdAt,
      passed: v.review?.passed ?? null,
    })),
    stale: current ? documentStale(repos, doc, current) : null,
    missingLinks: missingHeaderLinks(header.links),
  };
}
