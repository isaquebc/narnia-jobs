import { detectArea, inferSeniority, yearsOfExperience } from "./suggest";

/**
 * Resumo objetivo do cartão (F02 §2.2 item 2, decisão F02-2): 2–3 linhas heurísticas, zero tokens, nunca cortadas.
 * Texto em pt-BR (F02-12); a versão escrita pelo modelo é F04.
 */
export interface SummaryExperience {
  title: string;
  company: string;
  /** Ausente ou fora de YYYY[-MM[-DD]] = "sem data": entra na contagem à parte, não nos anos. */
  startDate?: string | undefined;
  endDate?: string | undefined;
  isCurrent: boolean;
  tech?: string[] | undefined;
}

export interface SummaryInput {
  experiences: SummaryExperience[];
  skills?: Array<{ name: string; category: string }>;
}

const DATE_RE = /^\d{4}(-\d{2})?(-\d{2})?$/;
const MAX_ARC_STOPS = 5;
const MAX_DOMAINS = 4;

const SENIORITY_LABEL: Record<string, string> = {
  junior: "júnior",
  pleno: "pleno",
  senior: "sênior",
  staff: "staff",
  manager: "gestão",
  director: "direção",
};

/** Nível pelo que o cargo atual diz; sem pista no título, cai nas faixas por anos. */
const TITLE_SENIORITY: Array<[RegExp, string]> = [
  [/\b(diretor|director|vp|cto|cpo)\b/i, "director"],
  [/\b(manager|gerente|head|coordenador|coordinator)\b/i, "manager"],
  [/\b(staff|principal)\b/i, "staff"],
  [/\b(s[eê]nior|sr\.?)\b/i, "senior"],
  [/\b(pleno|mid-level|mid)\b/i, "pleno"],
  [/\b(j[uú]nior|jr\.?|estagi[aá]ri[ao]|intern|trainee)\b/i, "junior"],
];
export function seniorityFromTitle(title: string): string | null {
  for (const [re, level] of TITLE_SENIORITY) if (re.test(title)) return level;
  return null;
}

const hasDate = (e: SummaryExperience): e is SummaryExperience & { startDate: string } =>
  typeof e.startDate === "string" && DATE_RE.test(e.startDate);

/** Ordem cronológica por início (sem data vai ao final, na ordem de chegada). */
function chronological(experiences: SummaryExperience[]): SummaryExperience[] {
  return experiences
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const da = hasDate(a.e) ? a.e.startDate : "9999";
      const db = hasDate(b.e) ? b.e.startDate : "9999";
      return da === db ? a.i - b.i : da.localeCompare(db);
    })
    .map(({ e }) => e);
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Trajetória: títulos únicos consecutivos em ordem cronológica; mais de 5 paradas vira início … fim. */
function arc(experiences: SummaryExperience[]): string[] {
  const stops: string[] = [];
  for (const e of chronological(experiences)) {
    const t = e.title.trim();
    if (stops.length === 0 || normalize(stops[stops.length - 1] as string) !== normalize(t))
      stops.push(t);
  }
  if (stops.length <= MAX_ARC_STOPS) return stops;
  return [...stops.slice(0, 2), "…", ...stops.slice(-2)];
}

/** Tecnologias mais frequentes nas experiências; empate por ordem alfabética (determinístico). */
function domains(experiences: SummaryExperience[]): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const e of experiences) {
    for (const t of e.tech ?? []) {
      const key = normalize(t);
      const cur = counts.get(key) ?? { label: t.trim(), n: 0 };
      cur.n += 1;
      counts.set(key, cur);
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .slice(0, MAX_DOMAINS)
    .map((d) => d.label);
}

export function buildObjectiveSummary(input: SummaryInput, now = new Date()): string[] {
  const all = input.experiences;
  if (all.length === 0) return ["Sem experiências registradas."];
  const dated = all.filter(hasDate);
  const undated = all.length - dated.length;
  const years = Math.round(
    yearsOfExperience(
      dated.map((e) => ({
        title: e.title,
        startDate: e.startDate,
        ...(e.endDate ? { endDate: e.endDate } : {}),
        isCurrent: e.isCurrent,
        tech: e.tech ?? [],
      })),
      now,
    ),
  );
  const companies = new Set(all.map((e) => normalize(e.company))).size;
  const areas = [
    ...new Set(chronological(all).map((e) => detectArea([e.title], input.skills ?? []))),
  ].filter((a) => a !== "other");

  const parts = [
    `${plural(years, "ano", "anos")} de carreira em ${plural(companies, "empresa", "empresas")}`,
  ];
  if (undated > 0) parts.push(`(${undated} sem data)`);
  const line1 = `${parts.join(" ")}${areas.length ? `; áreas: ${areas.join(", ")}` : ""}.`;

  const line2 = `Trajetória: ${arc(all).join(" → ")}.`;

  const latest = chronological(all).at(-1) as SummaryExperience;
  const seniority =
    seniorityFromTitle(latest.title) ??
    inferSeniority(
      years,
      latest.title,
      detectArea(
        all.map((e) => e.title),
        input.skills ?? [],
      ),
    );
  const doms = domains(all);
  const line3 = `Nível atual: ${SENIORITY_LABEL[seniority] ?? seniority}${
    doms.length ? `; domínios recorrentes: ${doms.join(", ")}` : ""
  }.`;

  return [line1, line2, line3];
}
