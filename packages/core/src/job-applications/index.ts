import type {
  ApplyOption,
  ApplyOptions,
  DocumentKind,
  JobApplication,
  JobApplicationSummary,
} from "@narnia-jobs/shared";
import type { Repos } from "../db";

export { ARCHIVE_AFTER_DAYS } from "../db/repos/job-applications";

/**
 * Candidaturas (F07 §0, requisitos do dono 2026-10-27): o botão "Aplicar" cria a candidatura travando a versão do CV
 * (obrigatória, F07-10) e a da carta; uma ativa por vaga (F07-9); o pipeline começa com as etapas padrão e cada
 * candidatura ajusta o seu (F07-8).
 */
export const DEFAULT_STAGES = [
  "Análise de currículo",
  "Bate-papo com Talent",
  "Entrevista com liderança",
  "Entrevista técnica",
  "Oferta",
  "Contratação",
] as const;

export type JobApplicationErrorCode =
  | "posting_not_found"
  | "cv_required"
  | "version_not_ready"
  | "wrong_posting"
  | "future_date"
  | "duplicate_pending"
  | "already_applied";

export class JobApplicationError extends Error {
  constructor(
    readonly code: JobApplicationErrorCode,
    message: string,
    readonly applicationId: string | null = null,
  ) {
    super(message);
    this.name = "JobApplicationError";
  }
}

const READY = new Set(["ready", "ready_with_issues"]);

/** Versões prontas do tipo pedido: as do documento da vaga primeiro, depois as do geral (sem vaga), a mais nova antes. */
function options(repos: Repos, postingId: string, kind: DocumentKind): ApplyOption[] {
  const docs = [
    ...repos.documents.list({ postingId, kind }),
    ...repos.documents.list({ kind }).filter((d) => d.postingId === null),
  ];
  return docs.flatMap((d) =>
    repos.documents
      .listVersions(d.id)
      .filter((v) => READY.has(v.status))
      .sort((a, b) => b.version - a.version)
      .map((v) => ({
        documentId: d.id,
        versionId: v.id,
        version: v.version,
        scope: d.postingId === null ? ("profile" as const) : ("posting" as const),
        profileId: d.profileId,
        createdAt: v.createdAt,
      })),
  );
}

export function applyOptions(repos: Repos, postingId: string): ApplyOptions {
  return {
    cvs: options(repos, postingId, "cv"),
    // carta sem vaga não existe na prática; fica só a da vaga
    coverLetters: options(repos, postingId, "cover_letter").filter((o) => o.scope === "posting"),
    activeApplicationId: repos.jobApplications.activeForPosting(postingId)?.id ?? null,
  };
}

/** Confere uma versão: existe, é do tipo, está pronta e é desta vaga (ou geral, para o CV). */
function checkVersion(repos: Repos, versionId: string, kind: DocumentKind, postingId: string) {
  const v = versionId ? repos.documents.versionById(versionId) : null;
  const d = v ? repos.documents.get(v.documentId) : null;
  if (!v || !d || d.kind !== kind) {
    if (kind === "cv") throw new JobApplicationError("cv_required", "Escolha o currículo enviado");
    throw new JobApplicationError("wrong_posting", "Carta não encontrada");
  }
  if (d.postingId !== postingId && !(kind === "cv" && d.postingId === null))
    throw new JobApplicationError("wrong_posting", "O documento é de outra vaga");
  if (!READY.has(v.status))
    throw new JobApplicationError("version_not_ready", "Essa versão ainda não está pronta");
  return d;
}

const today = (now: Date) => now.toISOString().slice(0, 10);

export function applyToPosting(
  repos: Repos,
  input: {
    postingId: string;
    cvVersionId: string;
    coverLetterVersionId?: string | null | undefined;
    appliedOn: string;
  },
  now = new Date(),
): JobApplication {
  const posting = repos.postings.get(input.postingId);
  if (!posting) throw new JobApplicationError("posting_not_found", "Vaga não encontrada");
  // a vaga nova que espera a decisão de duplicata (F06-9) pode ser apagada por ela
  if (posting.duplicate && posting.duplicate.decision === null)
    throw new JobApplicationError(
      "duplicate_pending",
      "Decida antes se esta vaga é a mesma já salva",
    );
  const cv = checkVersion(repos, input.cvVersionId, "cv", input.postingId);
  if (input.coverLetterVersionId)
    checkVersion(repos, input.coverLetterVersionId, "cover_letter", input.postingId);
  // um dia de folga para o fuso de quem está à frente do UTC
  const limit = today(new Date(now.getTime() + 86_400_000));
  if (input.appliedOn > limit)
    throw new JobApplicationError("future_date", "A data da candidatura está no futuro");
  const active = repos.jobApplications.activeForPosting(input.postingId);
  if (active)
    throw new JobApplicationError(
      "already_applied",
      "Já existe uma candidatura nesta vaga",
      active.id,
    );
  return repos.jobApplications.create(
    {
      postingId: input.postingId,
      profileId: cv.profileId,
      cvVersionId: input.cvVersionId,
      coverLetterVersionId: input.coverLetterVersionId ?? null,
      appliedOn: input.appliedOn,
      stages: [...DEFAULT_STAGES],
    },
    now,
  );
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

/** A data como a pessoa digita: 2026-10-15, 15/10/2026, 15/10 e 10/2026. */
function dateForms(iso: string): string[] {
  const [y, m, d] = iso.split("-");
  return [iso, `${d}/${m}/${y}`, `${d}/${m}`, `${m}/${y}`];
}

export function summarize(repos: Repos, app: JobApplication): JobApplicationSummary {
  const p = repos.postings.get(app.postingId);
  const current = app.stages.find((s) => s.id === app.currentStageId);
  return {
    ...app,
    posting: {
      company: p?.company ?? null,
      client: p?.client ?? null,
      title: p?.title ?? null,
      role: p?.role ?? null,
    },
    contacts: repos.postingContacts.list(app.postingId).map((c) => c.name),
    progress: { current: current?.position ?? 0, total: app.stages.length },
  };
}

/** Busca por empresa, cliente, cargo, data da candidatura e contato (§0-7). */
export function matchesSearch(row: JobApplicationSummary, q: string): boolean {
  const needle = norm(q);
  if (!needle) return true;
  const hay = [
    row.posting.company,
    row.posting.client,
    row.posting.title,
    ...row.contacts,
    ...dateForms(row.appliedOn),
  ]
    .filter((s): s is string => Boolean(s))
    .map(norm);
  return hay.some((h) => h.includes(needle));
}

export function listJobApplications(
  repos: Repos,
  filter: { q?: string | undefined; archived?: boolean | undefined },
): JobApplicationSummary[] {
  return repos.jobApplications
    .list({ archived: filter.archived ?? false })
    .map((a) => summarize(repos, a))
    .filter((row) => matchesSearch(row, filter.q ?? ""));
}
