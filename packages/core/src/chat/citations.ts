import type { Repos } from "../db";

/**
 * Citação conferida por código (F04-fix-fundamentacao, R5, FF-2): o índice dos fatos e as ferramentas mostram um id
 * curto de cada fato, pesquisa e vaga; o recrutador cita `[f:<id>]`, `[r:<id>]` ou `[v:<id>]` e o código confere se o
 * id existe (o balão da conversa mostra o que ele aponta; o inválido fica marcado). A frase com número ou termo dos
 * fatos sem citação também fica marcada.
 */
export type CitationKind = "f" | "r" | "v";

const MIN_REF = 6;
const hex = (id: string) => id.replace(/-/g, "").toLowerCase();

/** O id curto de cada id: os 6 últimos caracteres (a parte aleatória do uuid v7), mais se dois colidirem. */
export function shortRefs(ids: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of ids) {
    const h = hex(id);
    let n = MIN_REF;
    while (n < h.length && ids.some((o) => o !== id && hex(o).endsWith(h.slice(-n)))) n++;
    out.set(id, h.slice(-n));
  }
  return out;
}

/** Todos os ids de fato (as citações `f:` valem para qualquer tipo de fato). */
export function factIds(repos: Repos): string[] {
  const f = repos.facts;
  return [
    ...f.experiences.list(),
    ...f.achievements.list(),
    ...f.skills.list(),
    ...f.projects.list(),
    ...f.education.list(),
    ...f.languages.list(),
  ].map((x) => x.id);
}

/** Id curto de fato pronto para o índice e as ferramentas (`f:9c41d2`), calculado sobre todos os fatos. */
export function factRefs(repos: Repos): (id: string) => string {
  const refs = shortRefs(factIds(repos));
  return (id) => `f:${refs.get(id) ?? hex(id).slice(-MIN_REF)}`;
}

export const researchRef = (id: string) => `r:${hex(id).slice(-MIN_REF)}`;
export const postingRef = (id: string) => `v:${hex(id).slice(-MIN_REF)}`;

const BRACKET = /\[((?:[frv]:[0-9a-f]{6,32})(?:\s*[,;]\s*[frv]:[0-9a-f]{6,32})*)\]/gi;
const HAS_CITATION = new RegExp(BRACKET.source, "i");

export interface ParsedCitation {
  token: string;
  refs: Array<{ kind: CitationKind; ref: string }>;
}

export function parseCitations(text: string): ParsedCitation[] {
  return [...text.matchAll(BRACKET)].map((m) => ({
    token: m[0],
    refs: (m[1] as string).split(/[,;]/).map((part) => {
      const [kind, ref] = part.trim().toLowerCase().split(":") as [CitationKind, string];
      return { kind, ref };
    }),
  }));
}

export interface ResolvedCitation {
  kind: CitationKind;
  ref: string;
  valid: boolean;
  /** Título do balão (o fato, a fonte ou a vaga); null quando não confere. */
  label: string | null;
  /** Linha de apoio: tipo e período do fato, domínio da fonte, status da vaga. */
  detail: string | null;
  /** Link: a página da vaga ou a URL da fonte; fato não tem página própria. */
  url: string | null;
}

const span = (a?: string | null, b?: string | null, current?: boolean) =>
  a ? `${a}–${b ?? (current ? "atual" : a)}` : null;
const line = (...parts: Array<string | null | undefined>) =>
  parts.filter((p): p is string => Boolean(p)).join(" · ") || null;

function findBySuffix<T extends { id: string }>(list: T[], ref: string): T | null {
  const hits = list.filter((x) => hex(x.id).endsWith(ref));
  return hits.length === 1 ? (hits[0] as T) : null;
}

function resolveFact(repos: Repos, ref: string) {
  const f = repos.facts;
  const exp = findBySuffix(f.experiences.list(), ref);
  if (exp)
    return {
      label: line(exp.company, exp.title),
      detail: line("Experiência", span(exp.startDate, exp.endDate, exp.isCurrent)),
    };
  const ach = findBySuffix(f.achievements.list(), ref);
  if (ach) {
    const e = f.experiences.get(ach.experienceId);
    return {
      label: ach.metric ? `${ach.text} (${ach.metric})` : ach.text,
      detail: line("Conquista", e?.company, e?.title),
    };
  }
  const skill = findBySuffix(f.skills.list(), ref);
  if (skill)
    return {
      label: skill.name,
      detail: line("Skill", skill.level ? `nível ${skill.level}` : null),
    };
  const proj = findBySuffix(f.projects.list(), ref);
  if (proj)
    return {
      label: proj.name,
      detail: line("Projeto", proj.role, span(proj.startDate, proj.endDate)),
    };
  const edu = findBySuffix(f.education.list(), ref);
  if (edu)
    return {
      label: line(edu.institution, edu.course),
      detail: line("Formação", edu.degree, span(edu.startDate, edu.endDate)),
    };
  const lang = findBySuffix(f.languages.list(), ref);
  if (lang) return { label: lang.name, detail: line("Idioma", lang.level) };
  return null;
}

export function resolveCitations(repos: Repos, text: string): ResolvedCitation[] {
  const out: ResolvedCitation[] = [];
  let research: ReturnType<Repos["researchSources"]["list"]> | null = null;
  let postings: ReturnType<Repos["postings"]["list"]> | null = null;
  for (const c of parseCitations(text))
    for (const { kind, ref } of c.refs) {
      const none = { kind, ref, valid: false, label: null, detail: null, url: null };
      if (kind === "f") {
        const hit = resolveFact(repos, ref);
        out.push(hit ? { ...none, valid: true, ...hit } : none);
      } else if (kind === "r") {
        research ??= repos.researchSources.list({ limit: 100_000 });
        const s = findBySuffix(research, ref);
        out.push(
          s
            ? {
                ...none,
                valid: true,
                label: s.title,
                detail: line("Pesquisa", s.domain),
                url: s.url,
              }
            : none,
        );
      } else {
        postings ??= repos.postings.list();
        const p = findBySuffix(postings, ref);
        out.push(
          p
            ? {
                ...none,
                valid: true,
                label: line(p.company, p.title) ?? "Vaga",
                detail: "Vaga salva",
                url: `/vagas/${p.id}`,
              }
            : none,
        );
      }
    }
  return out;
}

/** Termos dos fatos que, citados numa frase, pedem a fonte: empresas, instituições, projetos e skills. */
export function citationTerms(repos: Repos): string[] {
  const f = repos.facts;
  const terms = [
    ...f.experiences.list().map((e) => e.company),
    ...f.education.list().map((e) => e.institution),
    ...f.projects.list().map((p) => p.name),
    ...f.skills.list().map((s) => s.name),
  ].filter((t): t is string => Boolean(t) && (t as string).trim().length >= 3);
  return [...new Set(terms)];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Frases que afirmam algo checável (número ou termo dos fatos) sem citação; perguntas ficam de fora. */
export function uncitedClaims(text: string, terms: string[]): string[] {
  const termRe = terms.length
    ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map(escapeRe).join("|")})(?![\\p{L}\\p{N}])`, "iu")
    : null;
  const sentences = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#{1,6} .*$/gm, "")
    .replace(/`[^`\n]*`/g, "")
    .replace(/^\s*(?:\d+[.)]|[-*•])\s+/gm, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.filter((s) => {
    if (s.endsWith("?") || HAS_CITATION.test(s)) return false;
    const plain = s.replace(/\*\*/g, "");
    return /\d/.test(plain) || Boolean(termRe?.test(plain));
  });
}
