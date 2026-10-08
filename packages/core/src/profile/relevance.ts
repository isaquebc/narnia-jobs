import type { EmphasisFactKind, EmphasisMode, Profile } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import type {
  AchievementRecord,
  EducationRecord,
  ExperienceRecord,
  LanguageRecord,
  ProjectRecord,
  SkillRecord,
} from "../db/repos/facts";

/**
 * Relevância por fato e perfil (F02 §2.3, decisão F02-2): nota 0–1 determinística com motivos para a UI.
 * Calculada junto com a reconstrução do cartão (não a cada escrita) e gravada em `profile_fact_relevance`.
 */
export interface FactSets {
  experiences: ExperienceRecord[];
  achievements: AchievementRecord[];
  projects: ProjectRecord[];
  education: EducationRecord[];
  skills: SkillRecord[];
  languages: LanguageRecord[];
}

export interface ScoredFact {
  factKind: EmphasisFactKind;
  factId: string;
  score: number;
  reasons: string[];
  hidden: boolean;
}

export type RelevanceProfile = Pick<Profile, "targetTitle" | "altTitles" | "area">;
export type EmphasisLike = { factKind: EmphasisFactKind; factId: string; mode: EmphasisMode };

/** Pesos dos componentes (somam 1 com o highlight; o `base` garante que todo fato visível tem nota > 0). */
export const RELEVANCE_WEIGHTS = {
  base: 0.2,
  recency: 0.25,
  target: 0.2,
  metric: 0.1,
  verified: 0.1,
  highlight: 0.15,
} as const;

/** Recência cai a zero depois deste horizonte (anos desde o fim da experiência). */
const RECENCY_HORIZON_YEARS = 10;
/** Recência acima deste valor ganha o motivo `recent`. */
const RECENT_THRESHOLD = 0.6;

const STOPWORDS = new Set([
  "de",
  "da",
  "do",
  "dos",
  "das",
  "e",
  "em",
  "the",
  "of",
  "and",
  "for",
  "com",
  "para",
]);

/** Fatos de todas as tabelas, pelos repos (entrada de `scoreFacts` e `buildProfileCard`). */
export function collectFactSets(repos: Repos): FactSets {
  return {
    experiences: repos.facts.experiences.list(),
    achievements: repos.facts.achievements.list(),
    projects: repos.facts.projects.list(),
    education: repos.facts.education.list(),
    skills: repos.facts.skills.list(),
    languages: repos.facts.languages.list(),
  };
}

function monthIndex(date: string | undefined): number | null {
  if (!date) return null;
  const m = /^(\d{4})(?:-(\d{2}))?/.exec(date);
  if (!m) return null;
  return Number(m[1]) * 12 + (m[2] ? Number(m[2]) - 1 : 0);
}

/** 1 para algo que termina agora, 0 para algo encerrado há 10+ anos; null sem data. */
function recencyOf(end: string | undefined, isCurrent: boolean, now: Date): number | null {
  const nowIdx = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const endIdx = isCurrent ? nowIdx : monthIndex(end);
  if (endIdx === null) return null;
  const yearsAgo = Math.max(0, nowIdx - endIdx) / 12;
  return Math.max(0, 1 - yearsAgo / RECENCY_HORIZON_YEARS);
}

export function targetTerms(profile: RelevanceProfile): string[] {
  const raw = [profile.targetTitle, ...profile.altTitles, profile.area].join(" ");
  return [
    ...new Set(
      raw
        .toLowerCase()
        .split(/[^\p{L}\p{N}+#.]+/u)
        .map((t) => t.replace(/^[.]+|[.]+$/g, ""))
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
    ),
  ];
}

function targetMatch(terms: string[], haystack: string[]): number {
  if (terms.length === 0) return 0;
  const text = haystack.join(" ").toLowerCase();
  const hits = terms.filter((t) => text.includes(t)).length;
  return Math.min(1, hits / 2);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

interface Components {
  recency: number | null;
  target: number;
  metric: boolean;
  verified: boolean;
}

export function scoreFacts(
  profile: RelevanceProfile,
  facts: FactSets,
  emphasis: EmphasisLike[],
  now = new Date(),
): ScoredFact[] {
  const terms = targetTerms(profile);
  const modes = new Map<string, EmphasisMode>();
  for (const e of emphasis) modes.set(`${e.factKind}:${e.factId}`, e.mode);

  const expRecency = new Map<string, number | null>();
  for (const e of facts.experiences) {
    expRecency.set(e.id, recencyOf(e.endDate, e.isCurrent, now));
  }
  // skill herda a experiência mais recente em que aparece no `tech`
  const skillRecency = new Map<string, number>();
  for (const e of facts.experiences) {
    const r = expRecency.get(e.id);
    if (r === null || r === undefined) continue;
    for (const t of e.tech) {
      const key = t.trim().toLowerCase();
      skillRecency.set(key, Math.max(skillRecency.get(key) ?? 0, r));
    }
  }

  const out: ScoredFact[] = [];
  const push = (kind: EmphasisFactKind, id: string, c: Components, inherited = false) => {
    const mode = modes.get(`${kind}:${id}`) ?? "normal";
    if (mode === "hidden") {
      out.push({ factKind: kind, factId: id, score: 0, reasons: ["hidden"], hidden: true });
      return;
    }
    const reasons: string[] = [];
    let score = RELEVANCE_WEIGHTS.base;
    const recency = c.recency ?? 0.5;
    score += RELEVANCE_WEIGHTS.recency * recency;
    if (recency >= RECENT_THRESHOLD) {
      reasons.push("recent");
      if (inherited) reasons.push("inherited");
    }
    if (c.target > 0) {
      score += RELEVANCE_WEIGHTS.target * c.target;
      reasons.push("target_match");
    }
    if (c.metric) {
      score += RELEVANCE_WEIGHTS.metric;
      reasons.push("metric");
    }
    if (c.verified) {
      score += RELEVANCE_WEIGHTS.verified;
      reasons.push("verified");
    }
    if (mode === "highlight") {
      score += RELEVANCE_WEIGHTS.highlight;
      reasons.push("highlight");
    }
    out.push({
      factKind: kind,
      factId: id,
      score: round3(Math.min(1, Math.max(0, score))),
      reasons: [...new Set(reasons)],
      hidden: false,
    });
  };

  for (const e of facts.experiences) {
    push("experience", e.id, {
      recency: expRecency.get(e.id) ?? null,
      target: targetMatch(terms, [e.title, e.summary ?? "", ...e.tech]),
      metric: false,
      verified: e.verified,
    });
  }
  for (const a of facts.achievements) {
    const exp = facts.experiences.find((e) => e.id === a.experienceId);
    push(
      "achievement",
      a.id,
      {
        recency: exp ? (expRecency.get(exp.id) ?? null) : null,
        target: targetMatch(terms, [a.text, a.metric ?? ""]),
        metric: Boolean(a.metric && a.metric.trim().length > 0),
        verified: a.verified,
      },
      true,
    );
  }
  for (const p of facts.projects) {
    push("project", p.id, {
      recency: recencyOf(p.endDate ?? p.startDate, !p.endDate && Boolean(p.startDate), now),
      target: targetMatch(terms, [p.name, p.description ?? "", ...p.tech]),
      metric: false,
      verified: p.verified,
    });
  }
  for (const ed of facts.education) {
    push("education", ed.id, {
      recency: recencyOf(ed.endDate ?? ed.startDate, ed.status === "in_progress", now),
      target: targetMatch(terms, [ed.course, ed.degree ?? "", ed.institution]),
      metric: false,
      verified: ed.verified,
    });
  }
  for (const s of facts.skills) {
    const inherited = skillRecency.get(s.name.trim().toLowerCase());
    push(
      "skill",
      s.id,
      {
        recency: inherited ?? null,
        target: targetMatch(terms, [s.name, s.category]),
        metric: false,
        verified: s.verified,
      },
      inherited !== undefined,
    );
  }
  for (const l of facts.languages) {
    push("language", l.id, {
      recency: null,
      target: targetMatch(terms, [l.name]),
      metric: false,
      verified: l.verified,
    });
  }
  return out;
}

/** Ordena por nota decrescente com desempate estável por id (determinístico). */
export function byScore(a: ScoredFact, b: ScoredFact): number {
  return b.score - a.score || a.factId.localeCompare(b.factId);
}
