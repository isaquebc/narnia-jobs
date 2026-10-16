import { createHash } from "node:crypto";
import type {
  CvBrief,
  CvLocale,
  DocumentKind,
  JobAnalysis,
  PreAnalysis,
  Profile,
  ProfileEmphasis,
} from "@narnia-jobs/shared";
import type { Repos } from "../db";
import { detectLanguage } from "../extract/language";
import { canonicalTerm } from "../postings/dictionary";
import { collectFactSets, scoreFacts } from "../profile/relevance";
import { type AtsTerm, termInText } from "./ats";

/**
 * Resumo do gerador (F05-11, §2.3): o código junta os dados da pessoa, do perfil e da vaga; calcula o score de match
 * de cada experiência e skill; tira o que a pessoa ocultou; separa as experiências de pouca aderência como roteiro de
 * entrevista (F05-15) e lista os termos da vaga sem evidência, que nunca podem ir para o CV (F05-20).
 */
export const MAX_CV_EXPERIENCES = 6;
const OLD_YEARS = 10;
const LOW_SCORE = 40;
const MAX_SKILLS = 24;
const MAX_PROJECTS = 4;

/** CV da vaga no idioma da vaga; sem vaga (ou idioma indefinido), o idioma de documentos do perfil (F05-16). */
export function documentLocale(
  profile: Pick<Profile, "docLocale">,
  posting: { jdText: string | null } | null,
): CvLocale {
  const lang = posting?.jdText ? detectLanguage(posting.jdText) : "unknown";
  if (lang === "en") return "en-US";
  if (lang === "pt") return "pt-BR";
  return profile.docLocale.startsWith("pt") ? "pt-BR" : "en-US";
}

const LANGUAGE_NAMES: Record<CvLocale, { label: string; names: RegExp }> = {
  "en-US": { label: "Inglês", names: /^(ingl[eê]s|english)$/i },
  "pt-BR": { label: "Português", names: /^(portugu[eê]s|portuguese)$/i },
};
const FLUENT = new Set(["B2", "C1", "C2", "native"]);

/** O currículo da pessoa cobre o idioma? Se não, ela é acionada antes de gerar (continuar ou parar, F05-16). */
export function languageCoverage(
  languages: Array<{ name: string; level: string }>,
  user: { country: string | null },
  locale: CvLocale,
): { covered: boolean; language: string } {
  const { label, names } = LANGUAGE_NAMES[locale];
  const known = languages.find((l) => names.test(l.name.trim()));
  if (known) return { covered: FLUENT.has(known.level), language: label };
  return { covered: locale === "pt-BR" && user.country === "BR", language: label };
}

/** Assinatura do perfil para a validade (F05-18): campos que mudam o CV + ênfases; os fatos têm `facts_version`. */
export function profileHash(
  profile: Pick<
    Profile,
    "targetTitle" | "altTitles" | "area" | "seniority" | "pitch" | "docLocale" | "market"
  >,
  emphasis: Array<Pick<ProfileEmphasis, "factKind" | "factId" | "mode" | "position">>,
): string {
  const em = [...emphasis]
    .map((e) => `${e.factKind}:${e.factId}:${e.mode}:${e.position ?? ""}`)
    .sort();
  const fields = [
    profile.targetTitle,
    profile.altTitles.join("|"),
    profile.area,
    profile.seniority,
    profile.pitch ?? "",
    profile.docLocale,
    profile.market,
  ];
  return createHash("sha256")
    .update(JSON.stringify([fields, em]))
    .digest("hex")
    .slice(0, 16);
}

export interface BuildBriefInput {
  kind: DocumentKind;
  profileId: string;
  postingId: string | null;
  locale: CvLocale;
  instructions: string | null;
  previousIssues: CvBrief["previousIssues"];
}

export interface BuildBriefResult {
  brief: CvBrief;
  atsTerms: AtsTerm[];
  /** Fatos não verificados que o gerador pode usar (banner na tela). */
  unverified: Array<{ kind: string; id: string }>;
}

const WEIGHT = { required: 2, nice: 1, other: 0.5 } as const;

function yearsSince(date: string | undefined, now: Date): number {
  if (!date) return 0;
  const [y, m] = date.split("-").map(Number);
  return (
    now.getUTCFullYear() - (y ?? now.getUTCFullYear()) + (now.getUTCMonth() + 1 - (m ?? 6)) / 12
  );
}

export function buildCvBrief(
  repos: Repos,
  input: BuildBriefInput,
  now = new Date(),
): BuildBriefResult {
  const profile = repos.profiles.get(input.profileId);
  if (!profile) throw new Error(`perfil ${input.profileId} não existe`);
  const user = repos.users.get();
  const facts = collectFactSets(repos);
  const emphasis = repos.emphasis.list(input.profileId);
  const scored = scoreFacts(profile, facts, emphasis, now);
  const rel = new Map(scored.map((s) => [`${s.factKind}:${s.factId}`, s]));
  const visible = (kind: string, id: string) => !(rel.get(`${kind}:${id}`)?.hidden ?? false);
  const relevance = (kind: string, id: string) => rel.get(`${kind}:${id}`)?.score ?? 0;
  const highlighted = new Set(
    emphasis.filter((e) => e.mode === "highlight").map((e) => `${e.factKind}:${e.factId}`),
  );

  const posting = input.postingId ? repos.postings.get(input.postingId) : null;
  const pre = (posting?.preAnalysis as PreAnalysis | null) ?? null;
  const analysisRecord = posting ? repos.jobAnalyses.latest(posting.id) : null;
  const analysis = (analysisRecord?.analysis as JobAnalysis | null) ?? null;
  const keywords = (pre?.keywords ?? []).filter(
    (k) => k.section !== "other" || k.evidence.length > 0,
  );
  const aliases = (term: string) => [term, ...(canonicalTerm(term)?.aliases ?? [])];
  const totalWeight = keywords.reduce((n, k) => n + WEIGHT[k.section], 0);
  const matchedIds = (analysis?.matches ?? []).map((m) => ({
    ids: new Set(m.evidence.map((e) => `${e.kind}:${e.id}`)),
    weight: m.strength === "strong" ? 1 : 0.5,
  }));

  const experiences = facts.experiences
    .filter((e) => visible("experience", e.id))
    .map((e) => {
      const achievements = facts.achievements.filter(
        (a) => a.experienceId === e.id && visible("achievement", a.id),
      );
      const text = [
        e.title,
        e.summary ?? "",
        ...e.tech,
        ...achievements.map((a) => `${a.text} ${a.metric ?? ""}`),
      ].join(" \n ");
      let score: number;
      if (posting) {
        const kw = keywords
          .filter((k) => termInText(aliases(k.term), text))
          .reduce((n, k) => n + WEIGHT[k.section], 0);
        const kwScore = totalWeight ? Math.min(1, kw / (0.5 * totalWeight)) : 0;
        const keys = [`experience:${e.id}`, ...achievements.map((a) => `achievement:${a.id}`)];
        const an = matchedIds
          .filter((m) => keys.some((k) => m.ids.has(k)))
          .reduce((n, m) => n + m.weight, 0);
        const anScore = matchedIds.length
          ? Math.min(1, an / Math.max(1, matchedIds.length * 0.5))
          : 0;
        score = 0.55 * kwScore + 0.25 * anScore + 0.2 * relevance("experience", e.id);
      } else score = relevance("experience", e.id);
      return { e, achievements, matchScore: Math.round(100 * Math.min(1, score)) };
    })
    .sort(
      (a, b) =>
        b.matchScore - a.matchScore || (b.e.startDate ?? "").localeCompare(a.e.startDate ?? ""),
    );

  const careerYears = Math.max(0, ...facts.experiences.map((e) => yearsSince(e.startDate, now)));
  const included: typeof experiences = [];
  const omitted: CvBrief["omitted"] = [];
  const target = posting ? "à vaga" : "ao perfil";
  for (const x of experiences) {
    const endedAgo = x.e.isCurrent ? 0 : yearsSince(x.e.endDate ?? x.e.startDate, now);
    const old = careerYears > OLD_YEARS && endedAgo > OLD_YEARS && x.matchScore < LOW_SCORE;
    if (included.length >= MAX_CV_EXPERIENCES || old)
      omitted.push({
        id: x.e.id,
        company: x.e.company,
        title: x.e.title,
        reason: old
          ? `Pouca aderência ${target} (score ${x.matchScore}) e encerrada há ${Math.floor(endedAgo)} anos.`
          : `Pouca aderência ${target} (score ${x.matchScore}); o CV mostra as ${MAX_CV_EXPERIENCES} mais aderentes.`,
      });
    else included.push(x);
  }

  const kwBySkill = (name: string) =>
    keywords.find((k) => termInText(aliases(k.term), name) || termInText(aliases(name), k.term));
  const skills = facts.skills
    .filter((s) => visible("skill", s.id))
    .map((s) => {
      const k = posting ? kwBySkill(s.name) : undefined;
      const score = k
        ? { required: 100, nice: 80, other: 60 }[k.section]
        : Math.round((posting ? 60 : 100) * relevance("skill", s.id));
      return { id: s.id, name: s.name, category: s.category ?? null, matchScore: score };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, MAX_SKILLS);

  const projects = facts.projects
    .filter((p) => visible("project", p.id))
    .map((p) => {
      const text = [p.name, p.description ?? "", ...p.tech].join(" ");
      const kw = posting
        ? keywords
            .filter((k) => termInText(aliases(k.term), text))
            .reduce((n, k) => n + WEIGHT[k.section], 0)
        : 0;
      const score =
        posting && totalWeight
          ? 0.7 * Math.min(1, kw / (0.5 * totalWeight)) + 0.3 * relevance("project", p.id)
          : relevance("project", p.id);
      return {
        id: p.id,
        name: p.name,
        description: p.description ?? null,
        tech: p.tech,
        matchScore: Math.round(100 * score),
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, MAX_PROJECTS);

  const evidenced = (term: string) =>
    keywords.some((k) => k.term === term && k.evidence.length > 0) ||
    facts.skills.some((s) => visible("skill", s.id) && termInText(aliases(term), s.name)) ||
    included.some((x) =>
      termInText(
        aliases(term),
        [...x.e.tech, x.e.summary ?? "", ...x.achievements.map((a) => a.text)].join(" "),
      ),
    );
  const atsTerms: AtsTerm[] = keywords
    .filter((k) => k.section !== "other")
    .map((k) => ({
      term: k.term,
      aliases: canonicalTerm(k.term)?.aliases ?? [],
      weight: WEIGHT[k.section],
      hasEvidence: evidenced(k.term),
    }));

  const sourceText = [
    ...included.flatMap((x) => [
      x.e.title,
      x.e.summary ?? "",
      ...x.achievements.map((a) => a.text),
    ]),
    ...facts.education.flatMap((e) => [e.course ?? "", e.degree ?? ""]),
  ].join(" \n ");
  const detected = detectLanguage(sourceText);
  const brief: CvBrief = {
    kind: input.kind,
    locale: input.locale,
    sourceLocale: detected === "pt" ? "pt-BR" : detected === "en" ? "en-US" : null,
    maxPages: 2,
    profile: {
      name: user?.fullName ?? user?.displayName ?? profile.name,
      targetTitle: profile.targetTitle,
      seniority: profile.seniority,
      area: profile.area,
      pitch: profile.pitch ?? null,
      yearsExperience: completeYears(facts.experiences, now),
    },
    posting: posting
      ? {
          company: posting.company,
          client: posting.client,
          title: posting.title,
          seniority: posting.seniority,
          required: keywords.filter((k) => k.section === "required").map((k) => k.term),
          nice: keywords.filter((k) => k.section === "nice").map((k) => k.term),
          responsibilities: posting.responsibilities,
          analysis: analysis
            ? {
                summary: analysis.summary,
                matches: analysis.matches.map((m) => ({
                  requirement: m.requirement,
                  evidence: m.evidence,
                })),
                gaps: analysis.gaps.map((g) => g.requirement),
                atsKeywordsMissing: analysis.atsKeywordsMissing.map((k) => k.term),
                cvImprovements: analysis.cvImprovements.map((c) => c.suggestion),
              }
            : null,
        }
      : null,
    experiences: included.map(({ e, achievements, matchScore }) => ({
      id: e.id,
      company: e.company,
      title: e.title,
      start: e.startDate ?? null,
      end: e.endDate ?? null,
      current: e.isCurrent,
      summary: e.summary ?? null,
      tech: e.tech,
      matchScore,
      achievements: achievements
        .map((a) => ({
          id: a.id,
          text: a.text,
          metric: a.metric ?? null,
          highlight: highlighted.has(`achievement:${a.id}`),
        }))
        .sort((a, b) => Number(b.highlight) - Number(a.highlight)),
    })),
    omitted,
    skills,
    projects,
    education: facts.education
      .filter((e) => visible("education", e.id))
      .map((e) => ({
        id: e.id,
        institution: e.institution,
        course: e.course ?? null,
        degree: e.degree ?? null,
      })),
    languages: facts.languages
      .filter((l) => visible("language", l.id))
      .map((l) => ({ id: l.id, name: l.name, level: l.level })),
    gaps: atsTerms.filter((t) => !t.hasEvidence).map((t) => t.term),
    instructions: input.instructions,
    previousIssues: input.previousIssues,
  };

  const usedKinds: Array<[string, Array<{ id: string; verified: boolean }>]> = [
    ["experience", included.map((x) => x.e)],
    ["achievement", included.flatMap((x) => x.achievements)],
    ["skill", facts.skills.filter((s) => skills.some((k) => k.id === s.id))],
    ["project", facts.projects.filter((p) => projects.some((k) => k.id === p.id))],
  ];
  const unverified = usedKinds.flatMap(([kind, list]) =>
    list.filter((f) => !f.verified).map((f) => ({ kind, id: f.id })),
  );
  return { brief, atsTerms, unverified };
}

/** Anos completos desde o início da primeira experiência (o gerador usa este número e não calcula outro). */
function completeYears(
  experiences: Array<{ startDate?: string | null }>,
  now: Date,
): number | null {
  const first = experiences
    .map((e) => e.startDate)
    .filter((d): d is string => Boolean(d))
    .sort()[0];
  if (!first) return null;
  const [y, m] = first.split("-").map(Number);
  if (!y) return null;
  const months = now.getUTCFullYear() * 12 + now.getUTCMonth() + 1 - (y * 12 + (m || 1));
  return Math.max(0, Math.floor(months / 12));
}
