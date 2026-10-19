import type {
  CoverLetterContent,
  CoverLetterDraft,
  CvContent,
  CvDraft,
  Paper,
} from "@narnia-jobs/shared";
import type { Repos } from "../db";
import type { DocumentVersionRecord, DocumentVersionSource } from "../db/repos/documents";
import { profileHash } from "./brief";
import { type EnqueueDocumentTask, isVersionActive } from "./request";
import { DOCUMENT_TASKS } from "./tasks";
import { isBuiltinTemplate } from "./templates";

/**
 * Edição e troca de layout (F05 §2.7, M6): a edição na tela e a do recrutador (`cv.edit`) criam uma versão nova e
 * enfileiram `cv.render` (valida a origem, monta, confere e revisa, sem o gerador). Trocar modelo, papel ou formato faz
 * o mesmo com o conteúdo atual. A comparação de versões é por linha de texto (F05-9).
 */
export type DocumentEditCode =
  | "document_not_found"
  | "conflict"
  | "busy"
  | "missing_content"
  | "template_not_found";

export class DocumentEditError extends Error {
  constructor(
    readonly code: DocumentEditCode,
    message: string,
  ) {
    super(message);
    this.name = "DocumentEditError";
  }
}

export type TemplateExists = (id: string) => boolean;

function mustEditable(repos: Repos, documentId: string) {
  const doc = repos.documents.get(documentId);
  if (!doc) throw new DocumentEditError("document_not_found", "Documento não encontrado.");
  const current = repos.documents.currentVersion(doc.id);
  if (current && isVersionActive(current))
    throw new DocumentEditError("busy", "Este documento está sendo gerado agora; espere terminar.");
  return { doc, current };
}

async function newRenderVersion(
  repos: Repos,
  enqueue: EnqueueDocumentTask,
  documentId: string,
  source: DocumentVersionSource,
  draft: { cv: CvDraft } | { letter: CoverLetterDraft },
): Promise<DocumentVersionRecord> {
  const doc = repos.documents.get(documentId);
  if (!doc) throw new DocumentEditError("document_not_found", "Documento não encontrado.");
  const profile = repos.profiles.get(doc.profileId);
  const posting = doc.postingId ? repos.postings.get(doc.postingId) : null;
  const version = repos.documents.addVersion(doc.id, {
    source,
    instructions: null,
    factsVersion: repos.settings.getFactsVersion(),
    postingUpdatedAt: posting?.contentUpdatedAt ?? null,
    profileHash: profile ? profileHash(profile, repos.emphasis.list(profile.id)) : "",
  });
  await enqueue({
    queue: "extract",
    type: DOCUMENT_TASKS.render,
    // uma tarefa por versão: com a chave do documento, a troca logo depois da montagem anterior era ignorada
    key: version.id,
    payload: { documentId: doc.id, versionId: version.id, ...draft },
    profileId: doc.profileId,
  });
  return version;
}

export async function editDocument(
  repos: Repos,
  enqueue: EnqueueDocumentTask,
  input: {
    documentId: string;
    baseVersion: number;
    cv?: CvDraft | undefined;
    letter?: CoverLetterDraft | undefined;
    source: DocumentVersionSource;
  },
): Promise<DocumentVersionRecord> {
  const { doc } = mustEditable(repos, input.documentId);
  if (doc.currentVersion !== input.baseVersion)
    throw new DocumentEditError(
      "conflict",
      `A versão atual é a ${doc.currentVersion}, não a ${input.baseVersion}: abra de novo antes de alterar.`,
    );
  const draft =
    doc.kind === "cv"
      ? input.cv
        ? { cv: input.cv }
        : null
      : input.letter
        ? { letter: input.letter }
        : null;
  if (!draft)
    throw new DocumentEditError(
      "missing_content",
      doc.kind === "cv" ? "Mande o CV em `cv`." : "Mande a carta em `letter`.",
    );
  return newRenderVersion(repos, enqueue, doc.id, input.source, draft);
}

/** Conteúdo montado → o formato do gerador (o mesmo que a edição e o recrutador mandam). */
export function contentToDraft(
  content: CvContent | CoverLetterContent,
): { cv: CvDraft } | { letter: CoverLetterDraft } {
  if (content.meta.kind === "cover_letter") {
    const l = content as CoverLetterContent;
    return { letter: { headline: l.header.title, greeting: l.greeting, paragraphs: l.paragraphs } };
  }
  const c = content as CvContent;
  return {
    cv: {
      headline: c.header.title,
      summary: c.summary,
      experiences: c.experiences.map((e) => ({
        factId: e.factId,
        title: e.title,
        location: e.location,
        bullets: e.bullets,
        tech: e.tech,
      })),
      education: c.education.map((e) => ({ factId: e.factId, course: e.course, degree: e.degree })),
      skills: c.skills.map((g) => ({
        label: g.label,
        items: g.items.map((i) => ({ name: i.name, factIds: i.factIds })),
      })),
      projects: c.projects.map((p) => ({ factId: p.factId, description: p.description ?? p.name })),
      adjacent: c.adjacent,
      sectionsOrder: c.sectionsOrder,
    },
  };
}

export async function changeDocumentLayout(
  repos: Repos,
  enqueue: EnqueueDocumentTask,
  input: {
    documentId: string;
    templateId?: string | undefined;
    paper?: Paper | undefined;
    format?: "pdf" | "text" | undefined;
    templateExists?: TemplateExists;
  },
): Promise<DocumentVersionRecord> {
  const { doc, current } = mustEditable(repos, input.documentId);
  const exists = input.templateExists ?? isBuiltinTemplate;
  if (input.templateId && !exists(input.templateId))
    throw new DocumentEditError("template_not_found", "Modelo não encontrado.");
  const content = current?.content as CvContent | CoverLetterContent | null | undefined;
  if (!content)
    throw new DocumentEditError("missing_content", "Ainda não há conteúdo para montar de novo.");
  const next = repos.documents.update(doc.id, {
    ...(input.templateId ? { templateId: input.templateId } : {}),
    ...(input.paper ? { paper: input.paper } : {}),
    ...(input.format && doc.kind === "cover_letter" ? { format: input.format } : {}),
  });
  const draft = contentToDraft(content);
  // já montado nesse modelo, papel e formato a partir do mesmo texto: volta a ser a atual, sem montar nem revisar
  const same = current ? sameLayoutVersion(repos, next, current) : null;
  if (same) {
    repos.documents.setCurrent(doc.id, same.version);
    return same;
  }
  return newRenderVersion(repos, enqueue, doc.id, "template", draft);
}

const FINISHED = new Set(["ready", "ready_with_issues"]);

/**
 * Origem do texto de uma versão: a última versão até ela que não veio de troca de modelo (gerada, atualizada,
 * editada). A troca de modelo remonta com os dados de agora e o conteúdo pode mudar um pouco (ex.: cargo como nos
 * dados), então comparar o conteúdo falhava (dono, 2026-10-19); a origem não muda. A atual nunca volta para trás de
 * uma origem mais nova (o reaproveitamento só anda dentro da mesma origem), então a regra vale sem coluna nova.
 */
function textOrigin(versions: DocumentVersionRecord[], version: number): number {
  return (
    versions
      .filter((v) => v.version <= version && v.source !== "template")
      .reduce((max, v) => Math.max(max, v.version), 0) || version
  );
}

function sameLayoutVersion(
  repos: Repos,
  doc: { id: string; templateId: string; paper: Paper; format: "pdf" | "text" },
  current: DocumentVersionRecord,
): DocumentVersionRecord | null {
  const versions = repos.documents.listVersions(doc.id);
  const origin = textOrigin(versions, current.version);
  return (
    versions.find(
      (v) =>
        FINISHED.has(v.status) &&
        v.content !== null &&
        v.templateId === doc.templateId &&
        v.paper === doc.paper &&
        v.format === doc.format &&
        textOrigin(versions, v.version) === origin,
    ) ?? null
  );
}

/** Texto do documento, uma linha por item (base do diff). */
export function documentText(content: CvContent | CoverLetterContent): string[] {
  if (content.meta.kind === "cover_letter") {
    const l = content as CoverLetterContent;
    return [l.greeting, ...l.paragraphs.map((p) => p.text), l.signature];
  }
  const c = content as CvContent;
  return [
    c.header.title,
    c.summary,
    ...c.experiences.flatMap((e) => [
      `${e.title} · ${e.company}`,
      ...e.bullets.map((b) => b.text),
      e.tech.join(", "),
    ]),
    ...c.skills.map((g) => `${g.label}: ${g.items.map((i) => i.name).join(", ")}`),
    ...c.projects.map((p) => `${p.name}: ${p.description ?? ""}`),
    ...c.education.map((e) => [e.degree, e.course, e.institution].filter(Boolean).join(", ")),
    c.languages.map((l) => `${l.name} (${l.level})`).join(" · "),
  ].filter((l) => l.trim().length > 0);
}

export type DiffLine = { op: "=" | "+" | "-"; text: string };

/** Diff por linha (LCS): o que saiu (-), entrou (+) e ficou (=). */
export function documentDiff(
  from: CvContent | CoverLetterContent,
  to: CvContent | CoverLetterContent,
): DiffLine[] {
  const a = documentText(from);
  const b = documentText(to);
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      (lcs[i] as number[])[j] =
        a[i] === b[j]
          ? ((lcs[i + 1] as number[])[j + 1] as number) + 1
          : Math.max((lcs[i + 1] as number[])[j] as number, (lcs[i] as number[])[j + 1] as number);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "=", text: a[i] as string });
      i++;
      j++;
    } else if (((lcs[i + 1] as number[])[j] as number) >= ((lcs[i] as number[])[j + 1] as number))
      out.push({ op: "-", text: a[i++] as string });
    else out.push({ op: "+", text: b[j++] as string });
  }
  while (i < n) out.push({ op: "-", text: a[i++] as string });
  while (j < m) out.push({ op: "+", text: b[j++] as string });
  return out;
}
