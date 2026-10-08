import type { SenioritySchema } from "@narnia-jobs/shared";
import type { z } from "zod";

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

  let seniority: Seniority;
  if (area === "management" && MANAGEMENT.test(latest.title)) seniority = "manager";
  else if (years < 2) seniority = "junior";
  else if (years < 5) seniority = "pleno";
  else if (years < 9) seniority = "senior";
  else seniority = "staff";

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
