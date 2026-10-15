import type {
  EvidenceRef,
  PostingFields,
  PostingRisk,
  PreAnalysis,
  PreAnalysisKeyword,
} from "@narnia-jobs/shared";
import { nowUtc } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import type { ProfileRecord } from "../db/repos/profiles";
import type { UserRecord } from "../db/repos/users";
import { canonicalTerm, normalizeTerm } from "./dictionary";
import { analyzePostingText, type HeuristicKeyword } from "./heuristics";

/**
 * Busca local das palavras-chave da vaga nos fatos do usuário (F06 §1.2: economizar tokens e tempo) e riscos por
 * perfil a partir das preferências reais (F06 §2.0: não há "preferências obrigatórias"; conflito vira risco). Tudo sem
 * modelo; o resultado é a pré-análise gravada na vaga.
 */

const EVIDENCE_PER_TERM = 5;

/** Termo canônico (ou o nome normalizado) → fatos do usuário que o citam. */
export function userTermIndex(repos: Repos): Map<string, EvidenceRef[]> {
  const index = new Map<string, EvidenceRef[]>();
  const add = (name: string, ref: EvidenceRef) => {
    const key = canonicalTerm(name)?.canonical ?? normalizeTerm(name);
    const list = index.get(key) ?? [];
    if (!list.some((r) => r.kind === ref.kind && r.id === ref.id)) list.push(ref);
    index.set(key, list);
  };
  const f = repos.facts;
  for (const s of f.skills.list()) add(s.name, { kind: "skill", id: s.id, label: s.name });
  for (const e of f.experiences.list())
    for (const t of e.tech ?? [])
      add(t, { kind: "experience", id: e.id, label: `${e.title} · ${e.company}` });
  for (const p of f.projects.list())
    for (const t of p.tech ?? []) add(t, { kind: "project", id: p.id, label: p.name });
  for (const l of f.languages.list()) add(l.name, { kind: "language", id: l.id, label: l.name });
  return index;
}

const FTS_KINDS = [
  "experience",
  "achievement",
  "project",
  "skill",
  "education",
  "language",
] as const;

export function matchKeywords(repos: Repos, keywords: HeuristicKeyword[]): PreAnalysisKeyword[] {
  const index = userTermIndex(repos);
  return keywords.map((k) => {
    let evidence = index.get(k.term) ?? [];
    if (evidence.length === 0) {
      // fora das listas de tecnologia: a busca de fatos (FTS) acha o termo em resumos e conquistas
      evidence = repos.factSearch
        .search(k.term, { kinds: [...FTS_KINDS], limit: EVIDENCE_PER_TERM })
        .map((h) => ({ kind: h.kind as EvidenceRef["kind"], id: h.id, label: h.title }));
    }
    return {
      term: k.term,
      category: k.category,
      section: k.section,
      count: k.count,
      source: "heuristic" as const,
      evidence: evidence.slice(0, EVIDENCE_PER_TERM),
    };
  });
}

const SENIORITY_RANK: Record<string, number> = {
  intern: 0,
  junior: 1,
  pleno: 2,
  senior: 3,
  staff: 4,
  lead: 4,
  manager: 5,
  director: 6,
};

const sameCity = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && normalizeTerm(a) === normalizeTerm(b));

/** Riscos de uma vaga para um perfil (preferências do perfil + do usuário). */
export function postingRisks(
  fields: Partial<PostingFields>,
  profile: Pick<ProfileRecord, "seniority" | "contractTypes" | "locations" | "salary">,
  user: Pick<UserRecord, "remotePref" | "relocation" | "city"> | null,
  opts: { requiresEnglish?: boolean; speaksEnglish?: boolean } = {},
): PostingRisk[] {
  const risks: PostingRisk[] = [];
  const add = (type: PostingRisk["type"], description: string) =>
    risks.push({ type, description, source: "heuristic" });
  const remoteOnly =
    user?.remotePref === "remote" ||
    (profile.locations.length > 0 && profile.locations.every((l) => l.remote === "remote"));
  const mode = fields.workMode;
  if (mode && mode !== "remote") {
    const where = fields.city
      ? `${fields.city}${fields.state ? `/${fields.state}` : ""}`
      : "local da vaga";
    const lives =
      sameCity(fields.city, user?.city) ||
      profile.locations.some((l) => sameCity(fields.city, l.city));
    if (remoteOnly)
      add(
        "work_mode",
        `Vaga ${mode === "hybrid" ? "híbrida" : "presencial"} em ${where}; o perfil aceita só remoto.`,
      );
    else if (fields.city && !lives && (user?.relocation?.mode ?? "none") === "none")
      add(
        "location",
        `Vaga ${mode === "hybrid" ? "híbrida" : "presencial"} em ${where}, fora das cidades do perfil e sem mudança aceita.`,
      );
  }
  if (
    fields.contractType &&
    profile.contractTypes.length > 0 &&
    !profile.contractTypes.includes(fields.contractType)
  )
    add(
      "contract",
      `Contratação ${fields.contractType.toUpperCase()}; o perfil aceita ${profile.contractTypes.map((c) => c.toUpperCase()).join("/")}.`,
    );
  const s = profile.salary;
  const offer = fields.salaryMax ?? fields.salaryMin;
  if (
    s &&
    offer &&
    fields.currency === s.currency &&
    (fields.salaryPeriod ?? s.period) === s.period &&
    offer < s.min
  )
    add(
      "salary",
      `Faixa citada até ${fields.currency} ${offer.toLocaleString("pt-BR")}, abaixo do mínimo do perfil (${s.currency} ${s.min.toLocaleString("pt-BR")}).`,
    );
  const asked = fields.seniority ? SENIORITY_RANK[fields.seniority] : undefined;
  const mine = SENIORITY_RANK[profile.seniority];
  if (asked !== undefined && mine !== undefined && Math.abs(asked - mine) >= 2)
    add(
      "seniority",
      `Senioridade pedida (${fields.seniority}) distante da do perfil (${profile.seniority}).`,
    );
  if (opts.requiresEnglish && opts.speaksEnglish === false)
    add("language", "A vaga pede inglês e não há inglês entre os idiomas cadastrados.");
  return risks;
}

/**
 * Pré-análise da vaga: heurística sobre a JD, busca local nos fatos e riscos por perfil não arquivado. `fields` (da
 * vaga já salva) completam o que a heurística não achou.
 */
export function buildPreAnalysis(
  repos: Repos,
  jdText: string,
  saved: Partial<PostingFields> = {},
): { preAnalysis: PreAnalysis; fields: Partial<PostingFields> } {
  const h = analyzePostingText(jdText);
  const keywords = matchKeywords(repos, h.keywords);
  const required = keywords.filter((k) => k.section === "required");
  const coverage = required.length
    ? required.filter((k) => k.evidence.length > 0).length / required.length
    : null;
  const fields = {
    ...h.fields,
    ...Object.fromEntries(
      Object.entries(saved).filter(
        ([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0),
      ),
    ),
  };
  const user = repos.users.get();
  const english = repos.facts.languages
    .list()
    .some((l) => canonicalTerm(l.name)?.canonical === "Inglês");
  const requiresEnglish = keywords.some((k) => k.term === "Inglês" && k.section === "required");
  const risksByProfile: Record<string, PostingRisk[]> = {};
  for (const p of repos.profiles.list())
    risksByProfile[p.id] = postingRisks(fields, p, user, {
      requiresEnglish,
      speaksEnglish: english,
    });
  return {
    fields: h.fields,
    preAnalysis: {
      version: 1,
      keywords,
      ngrams: h.ngrams,
      sectionsDetected: h.sectionsDetected,
      yearsMin: h.yearsMin,
      coverage,
      risksByProfile,
      createdAt: nowUtc(),
    },
  };
}
