import { createHash } from "node:crypto";
import {
  CONTRACT_TYPE_LABELS,
  compensationTrajectory,
  formatMoney,
  PROFILE_CARD_MAX_CHARS,
  type Profile,
} from "@narnia-jobs/shared";
import { charsToTokens } from "../estimate";
import { byScore, type EmphasisLike, type FactSets, type ScoredFact } from "./relevance";
import { buildObjectiveSummary } from "./summary";

/**
 * Cartão do perfil (F02 §2.2): função pura, ~300 tokens, teto rígido de 1.600 chars, corte por prioridade (F02-2).
 * Texto em pt-BR (decisão F02-12); F04 monta o system prompt a partir dele.
 */
export interface CardUser {
  fullName: string | null;
  displayName: string | null;
  city: string | null;
  country: string | null;
  remotePref: string | null;
}

export type CardProfile = Pick<
  Profile,
  | "targetTitle"
  | "seniority"
  | "area"
  | "goal"
  | "market"
  | "docLocale"
  | "salary"
  | "contractTypes"
  | "locations"
  | "availableFrom"
  | "needsResearch"
  | "pitch"
>;

export interface BuiltCard {
  text: string;
  tokensEst: number;
  hash: string;
}

export interface CardOptions {
  /** Teto em caracteres (padrão `PROFILE_CARD_MAX_CHARS`); exposto para testar o corte. */
  maxChars?: number;
}

export const CARD_LIMITS = {
  experiences: 3,
  skills: 8,
  skillsReduced: 3,
  pitchLines: 3,
  /** Teto por linha de pitch e de resumo (auditoria F02-4): o corte final nunca fatia uma linha. */
  pitchLineChars: 160,
  summaryLineChars: 220,
} as const;

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

const REMOTE_LABEL: Record<string, string> = {
  remote: "remoto",
  hybrid: "híbrido",
  onsite: "presencial",
  any: "remoto ou presencial",
};
const GOAL_LABEL: Record<string, string> = {
  new_job: "novo emprego",
  career_change: "transição de carreira",
  freelance: "freelance",
  promotion: "promoção",
};
const PERIOD_LABEL: Record<string, string> = { monthly: "mês", yearly: "ano", hourly: "hora" };
const CONTRACT_LABEL: Record<string, string> = {
  clt: "CLT",
  pj: "PJ",
  freelance: "freelance",
  internship: "estágio",
  temporary: "temporário",
};
const SENIORITY_LABEL: Record<string, string> = {
  junior: "júnior",
  pleno: "pleno",
  senior: "sênior",
  staff: "staff",
  manager: "gestão",
  director: "direção",
};
const RESEARCH_LABEL: Record<string, string> = {
  salary: "salário",
  contractTypes: "contratos",
  locations: "localidades",
  availableFrom: "disponibilidade",
};

const fmtMoney = (n: number) => Math.round(n).toLocaleString("pt-BR");
const period = (e: { startDate: string; endDate?: string | undefined; isCurrent: boolean }) =>
  `${e.startDate}–${e.isCurrent ? "atual" : (e.endDate ?? "?")}`;

function identityLines(user: CardUser, facts: FactSets, hiddenLang: Set<string>): string[] {
  const name = user.fullName ?? user.displayName ?? "Usuário";
  const place = [user.city, user.country].filter(Boolean).join(", ");
  const remote = user.remotePref ? (REMOTE_LABEL[user.remotePref] ?? user.remotePref) : null;
  const langs = facts.languages
    .filter((l) => !hiddenLang.has(l.id))
    .map((l) => `${l.name} (${l.level === "native" ? "nativo" : l.level})`);
  const parts = [name, place, remote].filter((p): p is string => Boolean(p));
  const first = parts.join(" · ");
  return langs.length ? [first, `Idiomas: ${langs.join(", ")}`] : [first];
}

function targetLine(profile: CardProfile): string {
  return `Alvo: ${profile.targetTitle} · ${SENIORITY_LABEL[profile.seniority] ?? profile.seniority} · área ${profile.area} · objetivo ${GOAL_LABEL[profile.goal] ?? profile.goal} · mercado ${profile.market} · documentos em ${profile.docLocale}`;
}

function careerLine(profile: CardProfile): string {
  const research = new Set(profile.needsResearch);
  const salary = research.has("salary")
    ? "a pesquisar"
    : profile.salary
      ? `${profile.salary.currency} ${fmtMoney(profile.salary.min)}–${fmtMoney(profile.salary.max)}/${PERIOD_LABEL[profile.salary.period] ?? profile.salary.period}`
      : "não informado";
  const contracts = research.has("contractTypes")
    ? "a pesquisar"
    : profile.contractTypes.length
      ? profile.contractTypes.map((c) => CONTRACT_LABEL[c] ?? c).join("/")
      : "não informado";
  const locations = research.has("locations")
    ? "a pesquisar"
    : profile.locations.length
      ? profile.locations
          .map(
            (l) =>
              `${l.city ? `${l.city} (${l.country})` : l.country} ${REMOTE_LABEL[l.remote] ?? l.remote}`,
          )
          .join(", ")
      : "não informado";
  const availability = research.has("availableFrom")
    ? "a pesquisar"
    : profile.availableFrom === "immediate"
      ? "imediata"
      : (profile.availableFrom ?? "não informada");
  return `Carreira: salário: ${salary} · contratos: ${contracts} · localidades: ${locations} · disponibilidade: ${availability}`;
}

function pitchLines(profile: CardProfile, maxLines: number): string[] {
  const raw = (profile.pitch ?? "").trim();
  if (!raw) return [];
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .map((l) => clip(l, CARD_LIMITS.pitchLineChars));
  return [`Pitch: ${lines[0] ?? ""}`, ...lines.slice(1).map((l) => `  ${l}`)];
}

function experienceLines(
  facts: FactSets,
  scored: Map<string, ScoredFact>,
  limit: number,
): string[] {
  const visible = facts.experiences
    .map((e) => ({ e, s: scored.get(`experience:${e.id}`) }))
    .filter((x): x is { e: FactSets["experiences"][number]; s: ScoredFact } =>
      Boolean(x.s && !x.s.hidden),
    )
    .sort((a, b) => byScore(a.s, b.s))
    .slice(0, limit);
  return visible.map(({ e }) => {
    const best = facts.achievements
      .filter((a) => a.experienceId === e.id)
      .map((a) => ({ a, s: scored.get(`achievement:${a.id}`) }))
      .filter((x) => x.s && !x.s.hidden)
      .sort((a, b) => byScore(a.s as ScoredFact, b.s as ScoredFact))[0]?.a;
    const achievement = best ? ` — ${best.text}${best.metric ? ` (${best.metric})` : ""}` : "";
    const terms = [
      e.employmentType ? CONTRACT_TYPE_LABELS[e.employmentType] : null,
      e.weeklyHours ? `${e.weeklyHours} h/semana` : null,
    ].filter(Boolean);
    const contract = terms.length ? ` · ${terms.join(", ")}` : "";
    return `• ${e.company} · ${e.title} · ${period(e)}${contract}${achievement}`;
  });
}

/**
 * Trajetória do salário (pedido do dono, 2026-10-13): equivalente mensal em ordem cronológica, com a variação na mesma
 * moeda; o recrutador vê se a pessoa está subindo ou descendo o próprio salário.
 */
function compensationLine(facts: FactSets): string | null {
  const points = compensationTrajectory(facts.experiences);
  if (points.length === 0) return null;
  const parts = points.map((p) => {
    const change =
      p.change === null ? "" : ` (${p.change >= 0 ? "+" : ""}${Math.round(p.change * 100)}%)`;
    return `${p.company} ${formatMoney(p.monthly, p.currency)}${change}`;
  });
  return `Remuneração (equivalente mensal): ${parts.join(" → ")}`;
}

function skillsLine(
  facts: FactSets,
  scored: Map<string, ScoredFact>,
  limit: number,
): string | null {
  const names = facts.skills
    .map((s) => ({ s, r: scored.get(`skill:${s.id}`) }))
    .filter((x): x is { s: FactSets["skills"][number]; r: ScoredFact } =>
      Boolean(x.r && !x.r.hidden),
    )
    .sort((a, b) => byScore(a.r, b.r))
    .slice(0, limit)
    .map((x) => x.s.name);
  return names.length ? `Skills: ${names.join(", ")}` : null;
}

function gapsLine(
  profile: CardProfile,
  facts: FactSets,
  scored: Map<string, ScoredFact>,
): string | null {
  const unverified = [
    ...facts.experiences,
    ...facts.achievements,
    ...facts.projects,
    ...facts.education,
    ...facts.skills,
    ...facts.languages,
  ].filter((f) => !f.verified).length;
  const parts: string[] = [];
  if (unverified > 0)
    parts.push(
      `${unverified} ${unverified === 1 ? "fato não verificado" : "fatos não verificados"}`,
    );
  if (profile.needsResearch.length > 0) {
    parts.push(
      `a pesquisar com o recrutador: ${profile.needsResearch.map((f) => RESEARCH_LABEL[f] ?? f).join(", ")}`,
    );
  }
  void scored;
  return `Lacunas: ${parts.length ? parts.join("; ") : "nenhuma conhecida"}`;
}

interface Plan {
  experiences: number;
  skills: number;
  gaps: boolean;
  pitchLines: number;
  summaryLines: number;
}

/** Ordem de corte (F02-2): lacunas → skills (8→3) → experiências (3→1) → pitch 3 linhas → resumo 2 linhas. */
function nextPlan(p: Plan): Plan | null {
  if (p.gaps) return { ...p, gaps: false };
  if (p.skills > CARD_LIMITS.skillsReduced) return { ...p, skills: CARD_LIMITS.skillsReduced };
  if (p.experiences > 1) return { ...p, experiences: 1 };
  if (p.pitchLines > CARD_LIMITS.pitchLines) return { ...p, pitchLines: CARD_LIMITS.pitchLines };
  if (p.summaryLines > 2) return { ...p, summaryLines: 2 };
  if (p.skills > 0) return { ...p, skills: 0 };
  if (p.experiences > 0) return { ...p, experiences: 0 };
  return null;
}

export function buildProfileCard(
  user: CardUser,
  profile: CardProfile,
  facts: FactSets,
  emphasis: EmphasisLike[],
  relevance: ScoredFact[],
  now = new Date(),
  opts: CardOptions = {},
): BuiltCard {
  const maxChars = opts.maxChars ?? PROFILE_CARD_MAX_CHARS;
  const scored = new Map(relevance.map((r) => [`${r.factKind}:${r.factId}`, r]));
  const hiddenLang = new Set(
    emphasis.filter((e) => e.factKind === "language" && e.mode === "hidden").map((e) => e.factId),
  );
  const visibleExperiences = facts.experiences.filter(
    (e) => !scored.get(`experience:${e.id}`)?.hidden,
  );
  const summary = buildObjectiveSummary(
    {
      experiences: visibleExperiences.map((e) => ({
        title: e.title,
        company: e.company,
        startDate: e.startDate,
        ...(e.endDate ? { endDate: e.endDate } : {}),
        isCurrent: e.isCurrent,
        tech: e.tech,
      })),
      skills: facts.skills.map((s) => ({ name: s.name, category: s.category })),
    },
    now,
  );

  const render = (p: Plan): string => {
    const lines: string[] = [
      ...identityLines(user, facts, hiddenLang),
      `Resumo: ${summary
        .slice(0, p.summaryLines)
        .map((l) => clip(l, CARD_LIMITS.summaryLineChars))
        .join(" ")}`,
      targetLine(profile),
      careerLine(profile),
      ...pitchLines(profile, p.pitchLines),
    ];
    if (p.experiences > 0) {
      const exps = experienceLines(facts, scored, p.experiences);
      if (exps.length) lines.push("Experiências:", ...exps);
      const pay = compensationLine(facts);
      if (pay) lines.push(pay);
    }
    if (p.skills > 0) {
      const sk = skillsLine(facts, scored, p.skills);
      if (sk) lines.push(sk);
    }
    if (p.gaps) {
      const g = gapsLine(profile, facts, scored);
      if (g) lines.push(g);
    }
    return lines.join("\n");
  };

  let plan: Plan | null = {
    experiences: CARD_LIMITS.experiences,
    skills: CARD_LIMITS.skills,
    gaps: true,
    pitchLines: CARD_LIMITS.pitchLines,
    summaryLines: 3,
  };
  let text = render(plan);
  while (text.length > maxChars) {
    plan = nextPlan(plan);
    if (!plan) break;
    text = render(plan);
  }
  // último recurso: remove linhas inteiras a partir do fim (nunca fatia uma linha; a identidade fica)
  if (text.length > maxChars) {
    const lines = text.split("\n");
    while (lines.join("\n").length > maxChars && lines.length > 1) lines.pop();
    text = lines.join("\n");
  }
  return {
    text,
    tokensEst: charsToTokens(text.length),
    hash: createHash("sha256").update(text).digest("hex"),
  };
}
