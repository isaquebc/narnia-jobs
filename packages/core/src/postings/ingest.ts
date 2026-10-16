import {
  type FieldSource,
  nowUtc,
  POSTING_FIELD_NAMES,
  POSTING_IDENTITY_FIELDS,
  type Posting,
  type PostingDuplicateCheck,
  type PostingDuplicateOutput,
  type PostingFieldName,
  type PostingFields,
  type PostingMergeOutput,
  type PreAnalysis,
  type PreAnalysisKeyword,
} from "@narnia-jobs/shared";
import type { Repos } from "../db";
import { canonicalTerm } from "./dictionary";
import { normalizeIdentityPart } from "./identity";
import { buildPreAnalysis, matchKeywords, postingRisks } from "./match";

/**
 * Pipeline da vaga (F06 §2.1) sem o modelo: criar a partir do texto (heurística na hora, pré-análise instantânea),
 * aplicar o merge do agente (sem sobrescrever o que o usuário editou) e resolver a duplicata (F06-9). As chamadas ao
 * modelo ficam no worker; aqui só o que o banco precisa.
 */

const filled = (v: unknown) =>
  v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);

export interface PostingIntake {
  text?: string | null | undefined;
  url?: string | null | undefined;
  /** Campos que o usuário (ou o recrutador, pela conversa) já informou: origem `user`. */
  fields?: Partial<PostingFields> | undefined;
}

/** Cria a vaga com a heurística aplicada e a pré-análise gravada; com texto, fica `extracting` para o worker. */
export function createPostingFromIntake(repos: Repos, intake: PostingIntake): Posting {
  const text = intake.text?.trim() || null;
  const given = Object.fromEntries(
    Object.entries(intake.fields ?? {}).filter(([, v]) => filled(v)),
  ) as Partial<PostingFields>;
  const analysis = text ? buildPreAnalysis(repos, text, given) : null;
  const heuristic = analysis?.fields ?? {};
  const sources: Record<string, FieldSource> = {};
  for (const k of Object.keys(heuristic)) sources[k] = "heuristic";
  for (const k of Object.keys(given)) sources[k] = "user";
  if (text) sources.jdText = "user";
  if (intake.url) sources.postingUrl = "user";
  const posting = repos.postings.create(
    {
      ...heuristic,
      ...given,
      ...(text ? { jdText: text } : {}),
      ...(intake.url ? { postingUrl: intake.url } : {}),
      fieldSources: sources,
    },
    { source: "heuristic", status: text ? "extracting" : "draft" },
  );
  if (analysis) repos.postings.setPreAnalysis(posting.id, analysis.preAnalysis);
  return repos.postings.get(posting.id) as Posting;
}

/**
 * Aplica o merge (F06-6): cada campo preenchido pelo agente entra com a origem dele, menos os que o usuário editou
 * (origem `user` vence sempre). As palavras-chave da pré-análise passam a ter a origem do merge e a evidência local é
 * recalculada; os riscos são refeitos com os campos finais.
 */
export function applyPostingMerge(
  repos: Repos,
  postingId: string,
  merge: PostingMergeOutput,
): Posting {
  const current = repos.postings.get(postingId);
  if (!current) throw new Error(`Vaga não encontrada: ${postingId}`);
  const sourceOf = new Map(merge.fieldSources.map((f) => [f.field, f.source]));
  const patch: Partial<PostingFields> = {};
  const sources: Partial<Record<PostingFieldName, FieldSource>> = {};
  for (const f of POSTING_FIELD_NAMES) {
    if (f === "jdText" || current.fieldSources[f] === "user") continue;
    const v = merge.fields[f];
    if (!filled(v)) continue;
    (patch as Record<string, unknown>)[f] = v;
    sources[f] = sourceOf.get(f) ?? "model";
  }
  const updated = repos.postings.update(postingId, patch, { sources, source: "model" });
  const pre = updated.preAnalysis as PreAnalysis | null;
  const keywords: PreAnalysisKeyword[] = matchKeywords(
    repos,
    merge.keywords.map((k) => ({
      term: canonicalTerm(k.term)?.canonical ?? k.term,
      category: canonicalTerm(k.term)?.category ?? "other",
      section: k.section,
      count: pre?.keywords.find((x) => x.term === k.term)?.count ?? 1,
    })),
  ).map((k) => ({
    ...k,
    source:
      merge.keywords.find((m) => (canonicalTerm(m.term)?.canonical ?? m.term) === k.term)?.source ??
      "model",
  }));
  repos.postings.setPreAnalysis(postingId, refreshPreAnalysis(repos, updated, pre, keywords));
  return repos.postings.get(postingId) as Posting;
}

/** Pré-análise com os campos atuais da vaga: cobertura e riscos refeitos (o usuário pode ter editado a vaga). */
export function refreshPreAnalysis(
  repos: Repos,
  posting: Posting,
  pre: PreAnalysis | null,
  keywords: PreAnalysisKeyword[] = pre?.keywords ?? [],
): PreAnalysis {
  const required = keywords.filter((k) => k.section === "required");
  const user = repos.users.get();
  const english = repos.facts.languages
    .list()
    .some((l) => canonicalTerm(l.name)?.canonical === "Inglês");
  const requiresEnglish = keywords.some((k) => k.term === "Inglês" && k.section === "required");
  const risksByProfile: PreAnalysis["risksByProfile"] = {};
  for (const p of repos.profiles.list())
    risksByProfile[p.id] = postingRisks(posting, p, user, {
      requiresEnglish,
      speaksEnglish: english,
    });
  return {
    version: 1,
    keywords,
    ngrams: pre?.ngrams ?? [],
    sectionsDetected: pre?.sectionsDetected ?? false,
    yearsMin: pre?.yearsMin ?? null,
    coverage: required.length
      ? required.filter((k) => k.evidence.length > 0).length / required.length
      : null,
    risksByProfile,
    createdAt: nowUtc(),
  };
}

/** Outra vaga salva com o mesmo hash de identidade (a mais recente), candidata a duplicata (F06-9). */
export function duplicateCandidate(repos: Repos, postingId: string): Posting | null {
  const p = repos.postings.get(postingId);
  if (!p?.identityHash) return null;
  return repos.postings.findByIdentity(p.identityHash, p.id)[0] ?? null;
}

/** Resumo de uma vaga para a comparação (campos preenchidos e a JD). */
export function duplicateSide(p: Posting): {
  fields: Partial<PostingFields>;
  jdText: string | null;
} {
  const fields: Partial<PostingFields> = {};
  for (const f of POSTING_FIELD_NAMES)
    if (f !== "jdText" && filled(p[f])) (fields as Record<string, unknown>)[f] = p[f];
  return { fields, jdText: p.jdText };
}

export function recordDuplicateCheck(
  repos: Repos,
  postingId: string,
  candidateId: string,
  out: PostingDuplicateOutput,
): PostingDuplicateCheck {
  const check: PostingDuplicateCheck = {
    candidateId,
    sameJob: out.sameJob,
    confidence: out.confidence,
    differences: out.differences,
    rationale: out.rationale,
    checkedAt: nowUtc(),
    decision: null,
  };
  repos.postings.setDuplicate(postingId, check);
  return check;
}

export type DuplicateAction = "update" | "new" | "cancel";

/**
 * Decisão do modal (F06-9): `update` leva para a vaga salva o que a nova trouxe de diferente (campos, contatos e notas)
 * e apaga a nova; `new` mantém as duas; `cancel` apaga a nova. Devolve a vaga que fica.
 */
export function decideDuplicate(
  repos: Repos,
  postingId: string,
  action: DuplicateAction,
): { keptId: string | null; removedId: string | null } {
  const incoming = repos.postings.get(postingId);
  if (!incoming?.duplicate) throw new Error("Esta vaga não tem comparação de duplicata pendente.");
  const savedId = incoming.duplicate.candidateId;
  if (action === "new") {
    repos.postings.setDuplicate(postingId, { ...incoming.duplicate, decision: "new" });
    return { keptId: postingId, removedId: null };
  }
  if (action === "update") {
    const saved = repos.postings.get(savedId);
    if (!saved) throw new Error("A vaga salva não existe mais.");
    const patch: Partial<PostingFields> = {};
    const sources: Partial<Record<PostingFieldName, FieldSource>> = {};
    for (const f of POSTING_FIELD_NAMES) {
      const v = incoming[f];
      if (!filled(v) || JSON.stringify(v) === JSON.stringify(saved[f])) continue;
      // empresa, cliente, cargo: só grafia diferente ("itau" × "Itaú") não troca a salva
      if (
        (POSTING_IDENTITY_FIELDS as readonly string[]).includes(f) &&
        normalizeIdentityPart(String(v)) === normalizeIdentityPart(String(saved[f] ?? ""))
      )
        continue;
      if (saved.fieldSources[f] === "user" && incoming.fieldSources[f] !== "user") continue;
      (patch as Record<string, unknown>)[f] = v;
      sources[f] = incoming.fieldSources[f] ?? "model";
    }
    repos.postings.update(savedId, patch, { sources });
    if (incoming.preAnalysis) repos.postings.setPreAnalysis(savedId, incoming.preAnalysis);
    for (const c of repos.postingContacts.list(postingId))
      repos.postingContacts.add(savedId, {
        name: c.name,
        origin: c.origin,
        email: c.email,
        phone: c.phone,
      });
    for (const n of repos.postingNotes.list(postingId))
      repos.postingNotes.add(savedId, n.author, n.body);
  }
  repos.postings.remove(postingId);
  return { keptId: action === "update" ? savedId : null, removedId: postingId };
}

/** Tarefas da vaga na fila `extract` (F06 §2.6). */
export const POSTING_TASKS = {
  extract: "posting.extract",
  analyze: "posting.analyze",
} as const;

/** Chaves de modelo por tarefa em `settings` (`models.<chave>`, F06-5, F06-13) e o padrão de cada uma. */
export const POSTING_MODEL_DEFAULTS = {
  posting_extract: "haiku",
  posting_merge: "haiku",
  posting_duplicate: "haiku",
  posting_analyze: "sonnet",
  // F05-13 (mesma tela de Modelos): os mesmos padrões de `DOCUMENT_MODEL_DEFAULTS`
  cv_generate: "sonnet",
  cv_review: "haiku",
} as const;
export type PostingModelKey = keyof typeof POSTING_MODEL_DEFAULTS;
