import type {
  ProfileSuggestionPayload,
  SenioritySchema,
  ProfileSuggestion as StoredSuggestion,
} from "@narnia-jobs/shared";
import type { z } from "zod";
import type { Repos } from "../db";
import { normalizeTitle } from "../db/repos/suggestions";
import { collectFactSets, type FactSets } from "./relevance";

type Seniority = z.infer<typeof SenioritySchema>;

export interface SuggestExperience {
  title: string;
  startDate: string;
  endDate?: string;
  isCurrent: boolean;
  tech: string[];
}
export interface SuggestSkill {
  name: string;
  category: string;
}
export interface SuggestInput {
  experiences: SuggestExperience[];
  skills: SuggestSkill[];
}
export interface ProfileSuggestion {
  targetTitle: string;
  altTitles: string[];
  seniority: Seniority;
  area: string;
  yearsOfExperience: number;
  reason: string;
}

const MANAGEMENT =
  /\b(gerente|manager|head|coordenador|coordinator|diretor|director|project manager|product manager|scrum master|líder de projetos|pm)\b/i;
const AREAS: Array<[string, RegExp]> = [
  ["data", /\b(dados|data|analytics|bi|machine learning|ml|cientista)\b/i],
  ["network", /\b(redes|network|infra(estrutura)?|sysadmin|devops|sre|cloud)\b/i],
  ["design", /\b(design|ux|ui|product design)\b/i],
  [
    "software",
    /\b(software|desenvolved|developer|engenheir|engineer|programador|backend|frontend|full ?stack|mobile)\b/i,
  ],
];
const ALT_BY_AREA: Record<string, string[]> = {
  software: ["Software Engineer", "Backend Engineer", "Desenvolvedor(a) de Software"],
  data: ["Data Engineer", "Analista de Dados", "Cientista de Dados"],
  network: ["Engenheiro(a) de Redes", "SRE", "DevOps Engineer"],
  design: ["Product Designer", "UX Designer"],
  management: ["Project Manager", "Delivery Manager", "Coordenador(a) de Projetos"],
  other: [],
};

function monthIndex(date: string, fallback: Date): number {
  const m = /^(\d{4})(?:-(\d{2}))?/.exec(date);
  if (!m) return fallback.getUTCFullYear() * 12 + fallback.getUTCMonth();
  return Number(m[1]) * 12 + (m[2] ? Number(m[2]) - 1 : 0);
}

/** Anos de experiência somando intervalos [início, fim) sem contar sobreposições em dobro. */
export function yearsOfExperience(experiences: SuggestExperience[], now = new Date()): number {
  const nowIdx = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const intervals = experiences
    .map((e) => {
      const start = monthIndex(e.startDate, now);
      const end = e.isCurrent || !e.endDate ? nowIdx : monthIndex(e.endDate, now) + 1;
      return [start, Math.max(start, end)] as [number, number];
    })
    .sort((a, b) => a[0] - b[0]);
  let months = 0;
  let cursor = Number.NEGATIVE_INFINITY;
  for (const [s, e] of intervals) {
    const from = Math.max(s, cursor);
    if (e > from) months += e - from;
    cursor = Math.max(cursor, e);
  }
  return Math.round((months / 12) * 10) / 10;
}

export function detectArea(titles: string[], skills: SuggestSkill[]): string {
  const joined = titles.join(" | ");
  if (MANAGEMENT.test(joined)) return "management";
  for (const [area, re] of AREAS) if (re.test(joined)) return area;
  if (skills.some((s) => s.category === "management")) return "management";
  if (skills.some((s) => ["language", "framework", "infra"].includes(s.category)))
    return "software";
  return "other";
}

/** Senioridade pelos anos de carreira (faixas de F01 §6.2) ou "manager" quando o título mais recente é de gestão. */
export function inferSeniority(years: number, latestTitle: string, area: string): Seniority {
  if (area === "management" && MANAGEMENT.test(latestTitle)) return "manager";
  if (years < 2) return "junior";
  if (years < 5) return "pleno";
  if (years < 9) return "senior";
  return "staff";
}

/** Heurística do passo 5 (F01 §6.2): senioridade por anos, área por títulos/skills, cargo-alvo pelo título mais recente. */
export function suggestProfile(input: SuggestInput, now = new Date()): ProfileSuggestion {
  const sorted = [...input.experiences].sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return (b.endDate ?? b.startDate).localeCompare(a.endDate ?? a.startDate);
  });
  const latest = sorted[0];
  const titles = input.experiences.map((e) => e.title);
  const area = detectArea(titles, input.skills);
  const years = yearsOfExperience(input.experiences, now);

  if (!latest) {
    return {
      targetTitle: area === "other" ? "Profissional" : (ALT_BY_AREA[area]?.[0] ?? "Profissional"),
      altTitles: ALT_BY_AREA[area] ?? [],
      seniority: "junior",
      area,
      yearsOfExperience: 0,
      reason: "Sem experiências registradas; sugerido perfil inicial (júnior). Ajuste livremente.",
    };
  }

  const seniority = inferSeniority(years, latest.title, area);

  const altTitles = (ALT_BY_AREA[area] ?? []).filter(
    (t) => t.toLowerCase() !== latest.title.toLowerCase(),
  );
  return {
    targetTitle: latest.title,
    altTitles,
    seniority,
    area,
    yearsOfExperience: years,
    reason: `Sugerido porque o título mais recente é "${latest.title}" e há ${years} anos de experiência (${seniority}); área "${area}" pelos títulos e skills.`,
  };
}

// --- F02 §2.6: várias sugestões a partir dos fatos existentes (heurística, zero tokens) ------------------

export interface SuggestProfilesOptions {
  existingTitles: string[];
  dismissedTitles: string[];
  market: string;
}

const LEAD_TITLE =
  /\b(tech lead|team lead|lead|l[ií]der|engineering manager|manager|gerente|head|coordenador(a)?|coordinator)\b/i;
const MANAGER_TITLE =
  /\b(engineering manager|manager|gerente|head|coordenador(a)?|coordinator|diretor(a)?|director)\b/i;
const PM_TITLE =
  /\b(project manager|product manager|scrum master|product owner|delivery manager)\b/i;
const MAX_SUGGESTIONS = 3;

function years(experiences: FactSets["experiences"], now: Date): number {
  return yearsOfExperience(
    experiences.map((e) => ({
      title: e.title,
      startDate: e.startDate,
      ...(e.endDate ? { endDate: e.endDate } : {}),
      isCurrent: e.isCurrent,
      tech: e.tech,
    })),
    now,
  );
}

/** Até 3 candidatas com justificativa e fatos de apoio; nunca repete perfil existente nem título dispensado. */
export function suggestProfiles(
  facts: FactSets,
  opts: SuggestProfilesOptions,
  now = new Date(),
): ProfileSuggestionPayload[] {
  const leadExps = facts.experiences.filter((e) => LEAD_TITLE.test(e.title));
  const managerExps = facts.experiences.filter((e) => MANAGER_TITLE.test(e.title));
  const pmExps = facts.experiences.filter((e) => PM_TITLE.test(e.title));
  const mgmtSkills = facts.skills.filter((s) => s.category === "management");
  const techArea = detectArea(
    facts.experiences.filter((e) => !LEAD_TITLE.test(e.title)).map((e) => e.title),
    facts.skills.map((s) => ({ name: s.name, category: s.category })),
  );
  const area = techArea === "other" || techArea === "management" ? "software" : techArea;
  const out: ProfileSuggestionPayload[] = [];
  const titles = (exps: FactSets["experiences"]) =>
    [...new Set(exps.map((e) => e.title))].join(", ");

  if (leadExps.length > 0) {
    const y = years(leadExps, now);
    out.push({
      title: "Engineering Manager",
      seniority: "manager",
      area,
      market: opts.market,
      rationale: `${y} anos em cargos de liderança (${titles(leadExps)}) sugerem um perfil de gestão de engenharia.`,
      supportingFactIds: leadExps.map((e) => e.id),
    });
  }
  if (mgmtSkills.length >= 2 || pmExps.length > 0) {
    const support = [...pmExps.map((e) => e.id), ...mgmtSkills.map((s) => s.id)];
    out.push({
      title: "Project Manager",
      seniority: pmExps.length > 0 ? "manager" : "senior",
      area: "management",
      market: opts.market,
      rationale:
        pmExps.length > 0
          ? `Cargos de gestão de projetos/produto (${titles(pmExps)}) e skills de gestão (${mgmtSkills.map((s) => s.name).join(", ") || "—"}).`
          : `Skills de gestão (${mgmtSkills.map((s) => s.name).join(", ")}) sugerem um perfil de gestão de projetos.`,
      supportingFactIds: support,
    });
  }
  if (leadExps.length > 0 && managerExps.length === 0) {
    out.push({
      title: "Tech Lead",
      seniority: "staff",
      area,
      market: opts.market,
      rationale: `Liderança técnica sem cargo de gestão formal (${titles(leadExps)}).`,
      supportingFactIds: leadExps.map((e) => e.id),
    });
  }

  const skip = new Set([...opts.existingTitles, ...opts.dismissedTitles].map(normalizeTitle));
  return out.filter((s) => !skip.has(normalizeTitle(s.title))).slice(0, MAX_SUGGESTIONS);
}

/** Roda a heurística sobre os repos e grava as sugestões novas com `source = heuristic`; devolve só as criadas. */
export const HEURISTIC_VERSION_KEY = "suggestions.heuristic_facts_version";

export function refreshHeuristicSuggestions(repos: Repos, now = new Date()): StoredSuggestion[] {
  // auditoria F02 (7): a heurística só roda (e só escreve) quando os fatos mudaram desde a última execução
  const version = repos.settings.getFactsVersion();
  if (repos.settings.get<number>(HEURISTIC_VERSION_KEY) === version) return [];
  repos.settings.set(HEURISTIC_VERSION_KEY, version);
  const facts = collectFactSets(repos);
  const profiles = repos.profiles.list({ includeArchived: true });
  const market = repos.profiles.active()?.market ?? profiles[0]?.market ?? "BR";
  const candidates = suggestProfiles(
    facts,
    {
      existingTitles: profiles.map((p) => p.targetTitle),
      dismissedTitles: repos.suggestions.dismissedTitles(),
      market,
    },
    now,
  );
  const created: StoredSuggestion[] = [];
  for (const payload of candidates) {
    const s = repos.suggestions.create({ source: "heuristic", payload });
    if (s) created.push(s);
  }
  return created;
}
