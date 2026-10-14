import type { Conflict, FactProposal, Profile, ProposalMatch } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import type {
  AchievementRecord,
  EducationRecord,
  ExperienceRecord,
  LanguageRecord,
  ProjectRecord,
  SkillRecord,
} from "../db/repos/facts";
import { targetTerms } from "../profile/relevance";

/**
 * Reconciliação com os fatos existentes (F03 §2.8), 0 tokens: cada proposta vira `new`, `existing` (aceitar só
 * acrescenta uma fonte) ou `conflict` (campo a campo, com valor atual, novo e origens). Compara só com fatos;
 * proposta rejeitada antes nunca virou fato e não gera conflito. Nada é mesclado automaticamente.
 */

const strip = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "");

export function normalizeText(s: string): string {
  return strip(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const COMPANY_SUFFIXES = new Set([
  "ltda",
  "ltd",
  "inc",
  "sa",
  "s a",
  "llc",
  "corp",
  "me",
  "eireli",
  "gmbh",
  "co",
]);

export function normalizeCompany(s: string): string {
  let words = normalizeText(s.replace(/\bS\.\s?A\.?/gi, " sa ")).split(" ");
  while (words.length > 1 && COMPANY_SUFFIXES.has(words.at(-1) as string))
    words = words.slice(0, -1);
  return words.join(" ");
}

const SKILL_SYNONYMS: Record<string, string> = {
  reactjs: "react",
  "react js": "react",
  nodejs: "node js",
  node: "node js",
  postgres: "postgresql",
  psql: "postgresql",
  k8s: "kubernetes",
  golang: "go",
  js: "javascript",
  ts: "typescript",
  vuejs: "vue",
  "vue js": "vue",
  nextjs: "next js",
  py: "python",
  mongo: "mongodb",
};

/** Nome canônico de skill: `normalizeSkillName` do F01 + pontuação + sinônimos (ReactJS → React). */
export function canonicalSkill(name: string): string {
  const n = normalizeText(name.replace(/\./g, " "));
  return SKILL_SYNONYMS[n] ?? SKILL_SYNONYMS[n.replace(/\s/g, "")] ?? n;
}

function normalizeUrl(u: string): string {
  return u
    .trim()
    .toLowerCase()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

/* ---------- datas parciais ---------- */

function monthIndex(d: string, edge: "start" | "end"): number {
  const [y, m] = d.split("-");
  return Number(y) * 12 + (m ? Number(m) - 1 : edge === "start" ? 0 : 11);
}

function range(
  start: string,
  end: string | undefined,
  isCurrent: boolean,
  now: Date,
): [number, number] {
  const s = monthIndex(start, "start");
  const e = end
    ? monthIndex(end, "end")
    : isCurrent
      ? now.getUTCFullYear() * 12 + now.getUTCMonth()
      : s;
  return [s, Math.max(s, e)];
}

/** Sobreposição relativa ao menor dos dois períodos (≥ 0,5 = mesma passagem pela empresa). */
function overlapRatio(a: [number, number], b: [number, number]): number {
  const inter = Math.min(a[1], b[1]) - Math.max(a[0], b[0]) + 1;
  if (inter <= 0) return 0;
  return inter / Math.min(a[1] - a[0] + 1, b[1] - b[0] + 1);
}

/** "2023" e "2023-02" não conflitam (precisão diferente); ausente de um lado também não. */
function datesDiffer(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  return !(a.startsWith(b) || b.startsWith(a));
}

/* ---------- fatos existentes ---------- */

export interface ExistingFacts {
  experiences: ExperienceRecord[];
  achievements: AchievementRecord[];
  education: EducationRecord[];
  skills: SkillRecord[];
  languages: LanguageRecord[];
  projects: ProjectRecord[];
}

const sameCompensation = (
  a: { amount: number; period: string; currency: string } | undefined,
  b: { amount: number; period: string; currency: string },
) => Boolean(a && a.amount === b.amount && a.period === b.period && a.currency === b.currency);

export function existingFacts(repos: Repos): ExistingFacts {
  return {
    experiences: repos.facts.experiences.list(),
    achievements: repos.facts.achievements.list(),
    education: repos.facts.education.list(),
    skills: repos.facts.skills.list(),
    languages: repos.facts.languages.list(),
    projects: repos.facts.projects.list(),
  };
}

export interface MatchResult {
  index: number;
  match: ProposalMatch;
  targetId: string | null;
  conflict: Conflict | null;
}

type Field = Conflict["fields"][number];
type SourceOf = (fact: { sourceId: string | null }) => string | null;

function result(index: number, targetId: string, fields: Field[]): MatchResult {
  return fields.length
    ? { index, match: "conflict", targetId, conflict: { targetId, fields } }
    : { index, match: "existing", targetId, conflict: null };
}

const fresh = (index: number): MatchResult => ({
  index,
  match: "new",
  targetId: null,
  conflict: null,
});

export function reconcileProposals(
  items: { index: number; proposal: FactProposal }[],
  facts: ExistingFacts,
  now: Date = new Date(),
  o: { proposedSource?: string | null; sourceOf?: SourceOf } = {},
): MatchResult[] {
  const sourceOf: SourceOf = o.sourceOf ?? ((f) => f.sourceId);
  const proposedSource = o.proposedSource ?? null;
  const field = (
    name: string,
    fact: { sourceId: string | null },
    current: unknown,
    proposed: unknown,
  ): Field => ({
    field: name,
    current,
    proposed,
    currentSource: sourceOf(fact),
    proposedSource,
  });
  const byIndex = new Map<number, MatchResult>();

  for (const { index, proposal: p } of items) {
    let r: MatchResult = fresh(index);
    if (p.kind === "experience") {
      const d = p.data;
      const mine = range(d.startDate, d.endDate, d.isCurrent, now);
      const target = facts.experiences.find(
        (e) =>
          normalizeCompany(e.company) === normalizeCompany(d.company) &&
          overlapRatio(range(e.startDate, e.endDate, e.isCurrent, now), mine) >= 0.5,
      );
      if (target) {
        const fields: Field[] = [];
        if (normalizeText(target.title) !== normalizeText(d.title)) {
          fields.push(field("title", target, target.title, d.title));
        }
        if (datesDiffer(target.startDate, d.startDate)) {
          fields.push(field("startDate", target, target.startDate, d.startDate));
        }
        if (datesDiffer(target.endDate, d.endDate)) {
          fields.push(field("endDate", target, target.endDate, d.endDate));
        }
        if (target.isCurrent !== d.isCurrent) {
          fields.push(field("isCurrent", target, target.isCurrent, d.isCurrent));
        }
        // campos novos (2026-10-13): o que o texto traz e o fato não tem (ou tem diferente) vira campo a atualizar
        if (d.employmentType && d.employmentType !== target.employmentType)
          fields.push(field("employmentType", target, target.employmentType, d.employmentType));
        if (d.weeklyHours !== undefined && d.weeklyHours !== target.weeklyHours)
          fields.push(field("weeklyHours", target, target.weeklyHours, d.weeklyHours));
        if (d.compensation && !sameCompensation(target.compensation, d.compensation))
          fields.push(field("compensation", target, target.compensation, d.compensation));
        for (const key of ["benefits", "benefitsOther"] as const) {
          const current: string[] = target[key] ?? [];
          const extra = (d[key] ?? []).filter((b) => !current.includes(b));
          // soma com os que já estavam: aceitar não apaga benefício conhecido
          if (extra.length > 0) fields.push(field(key, target, current, [...current, ...extra]));
        }
        r = result(index, target.id, fields);
      }
    } else if (p.kind === "achievement") {
      // experiência do perfil (experienceId) ou a da mesma extração que bateu com uma do perfil
      const parentId =
        p.data.experienceId ??
        byIndex.get(
          items.filter((x) => x.proposal.kind === "experience")[p.data.experienceIndex ?? -1]
            ?.index ?? -1,
        )?.targetId;
      if (parentId) {
        const text = normalizeText(p.data.text);
        const same = facts.achievements.find(
          (a) => a.experienceId === parentId && normalizeText(a.text) === text,
        );
        if (same) r = result(index, same.id, []);
      }
    } else if (p.kind === "education") {
      const d = p.data;
      const target = facts.education.find(
        (e) =>
          normalizeText(e.institution) === normalizeText(d.institution) &&
          normalizeText(e.course) === normalizeText(d.course),
      );
      if (target) {
        const fields: Field[] = [];
        if (target.degree && d.degree && normalizeText(target.degree) !== normalizeText(d.degree)) {
          fields.push(field("degree", target, target.degree, d.degree));
        }
        if (target.status !== d.status)
          fields.push(field("status", target, target.status, d.status));
        if (datesDiffer(target.startDate, d.startDate))
          fields.push(field("startDate", target, target.startDate, d.startDate));
        if (datesDiffer(target.endDate, d.endDate))
          fields.push(field("endDate", target, target.endDate, d.endDate));
        r = result(index, target.id, fields);
      }
    } else if (p.kind === "skill") {
      const target = facts.skills.find(
        (s) => canonicalSkill(s.name) === canonicalSkill(p.data.name),
      );
      if (target) r = result(index, target.id, []);
    } else if (p.kind === "language") {
      const target = facts.languages.find(
        (l) => normalizeText(l.name) === normalizeText(p.data.name),
      );
      if (target) {
        r = result(
          index,
          target.id,
          target.level !== p.data.level ? [field("level", target, target.level, p.data.level)] : [],
        );
      }
    } else if (p.kind === "project") {
      const d = p.data;
      const target = facts.projects.find(
        (x) =>
          (d.url && x.url && normalizeUrl(x.url) === normalizeUrl(d.url)) ||
          normalizeText(x.name) === normalizeText(d.name),
      );
      if (target) {
        const fields: Field[] = [];
        if (datesDiffer(target.startDate, d.startDate))
          fields.push(field("startDate", target, target.startDate, d.startDate));
        if (datesDiffer(target.endDate, d.endDate))
          fields.push(field("endDate", target, target.endDate, d.endDate));
        r = result(index, target.id, fields);
      }
    }
    byIndex.set(index, r);
  }
  return items.map((i) => byIndex.get(i.index) as MatchResult);
}

/* ---------- tags por perfil ---------- */

function proposalText(p: FactProposal): string[] {
  switch (p.kind) {
    case "experience":
      return [p.data.title, p.data.summary ?? "", ...p.data.tech];
    case "achievement":
      return [p.data.text];
    case "education":
      return [p.data.course, p.data.degree ?? ""];
    case "skill":
      return [p.data.name];
    case "project":
      return [p.data.name, p.data.description ?? "", ...(p.data.tech ?? [])];
    default:
      return [];
  }
}

/** Sugere os perfis cujo alvo (cargo, alternativos, área) aparece no fato; nunca aplicado sem o usuário. */
export function suggestProfileTags(
  p: FactProposal,
  profiles: Pick<Profile, "id" | "targetTitle" | "altTitles" | "area">[],
): string[] {
  const text = normalizeText(proposalText(p).join(" "));
  if (!text) return [];
  return profiles
    .filter((prof) => targetTerms(prof).some((t) => text.includes(normalizeText(t))))
    .map((prof) => prof.id);
}

/* ---------- aplicação num run ---------- */

/** Reconcilia as propostas pendentes do run e grava `match`, conflito e tags sugeridas. */
export function applyReconciliation(
  repos: Repos,
  runId: string,
  now: Date = new Date(),
): Record<ProposalMatch, number> {
  const run = repos.ingestionRuns.get(runId);
  const pending = repos.proposals.listByRun(runId).filter((p) => p.decision === "pending");
  const sources = new Map<string, string | null>();
  const sourceOf: SourceOf = (f) => {
    if (!f.sourceId) return null;
    if (!sources.has(f.sourceId))
      sources.set(f.sourceId, repos.factSources.get(f.sourceId)?.kind ?? null);
    return sources.get(f.sourceId) ?? null;
  };
  const results = reconcileProposals(
    pending.map((p) => ({ index: p.index, proposal: p.proposal })),
    existingFacts(repos),
    now,
    { proposedSource: run?.source ?? null, sourceOf },
  );
  const profiles = repos.profiles.list();
  const counts: Record<ProposalMatch, number> = { new: 0, existing: 0, conflict: 0 };
  pending.forEach((p, i) => {
    const r = results[i] as MatchResult;
    repos.proposals.setMatch(p.id, { match: r.match, targetId: r.targetId, conflict: r.conflict });
    repos.proposals.setSuggestedProfiles(p.id, suggestProfileTags(p.proposal, profiles));
    counts[r.match]++;
  });
  return counts;
}
