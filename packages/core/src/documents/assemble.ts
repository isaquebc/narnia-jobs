import {
  type CoverLetterContent,
  CoverLetterContentSchema,
  type CoverLetterDraft,
  type CoverLetterFormat,
  type CvBrief,
  type CvContent,
  CvContentSchema,
  type CvDraft,
  type CvHeader,
  type CvLocale,
  type CvReviewIssue,
  coverLetterWordCount,
  type EvidenceId,
  type Paper,
} from "@narnia-jobs/shared";
import type { Repos } from "../db";
import { canonicalTerm, normalizeTerm } from "../postings/dictionary";
import { termInText } from "./ats";
import { languageName } from "./labels";

/**
 * Montagem do documento a partir do rascunho do gerador (F05-11): o código preenche cabeçalho, empresa, cargo, datas,
 * local, score, formação e idiomas pelos fatos, e confere o que o modelo escreveu. Origem que não existe, experiência
 * fora do resumo, tecnologia que a pessoa não tem e termo da vaga sem evidência viram apontamentos de alucinação
 * (F05-13/F05-20), que reprovam a versão.
 */
export interface AssembleMeta {
  locale: CvLocale;
  paper: Paper;
  profileId: string;
  postingId: string | null;
  generatedAt: string;
}

const issue = (message: string, where: string | null = null): CvReviewIssue => ({
  area: "hallucination",
  severity: "error",
  message,
  where,
});

const key = (e: EvidenceId) => `${e.kind}:${e.id}`;

function allowedIds(brief: CvBrief): Set<string> {
  return new Set([
    ...brief.experiences.map((e) => `experience:${e.id}`),
    ...brief.experiences.flatMap((e) => e.achievements.map((a) => `achievement:${a.id}`)),
    ...brief.skills.map((s) => `skill:${s.id}`),
    ...brief.projects.map((p) => `project:${p.id}`),
    ...brief.education.map((e) => `education:${e.id}`),
    ...brief.languages.map((l) => `language:${l.id}`),
  ]);
}

function checkRefs(refs: EvidenceId[], allowed: Set<string>, where: string, out: CvReviewIssue[]) {
  for (const r of refs)
    if (!allowed.has(key(r)))
      out.push(issue(`A origem ${r.kind} ${r.id} não existe nos seus dados.`, where));
}

const aliasesOf = (term: string) => [term, ...(canonicalTerm(term)?.aliases ?? [])];

function gapIssues(brief: CvBrief, texts: Array<[string, string]>): CvReviewIssue[] {
  const out: CvReviewIssue[] = [];
  for (const gap of brief.gaps)
    for (const [where, text] of texts)
      if (termInText(aliasesOf(gap), text)) {
        out.push(
          issue(`O termo "${gap}" aparece no documento sem evidência nos seus dados.`, where),
        );
        break;
      }
  return out;
}

function unverifiedOf(repos: Repos, used: EvidenceId[]): EvidenceId[] {
  const lists: Record<string, Array<{ id: string; verified: boolean }>> = {
    experience: repos.facts.experiences.list(),
    achievement: repos.facts.achievements.list(),
    skill: repos.facts.skills.list(),
    project: repos.facts.projects.list(),
    education: repos.facts.education.list(),
    language: repos.facts.languages.list(),
  };
  return used.filter((u) => lists[u.kind]?.find((f) => f.id === u.id)?.verified === false);
}

function dedupe(refs: EvidenceId[]): EvidenceId[] {
  const seen = new Map<string, EvidenceId>();
  for (const r of refs) seen.set(key(r), r);
  return [...seen.values()];
}

export function assembleCv(
  repos: Repos,
  brief: CvBrief,
  draft: CvDraft,
  ctx: { meta: AssembleMeta; header: CvHeader },
): { content: CvContent; issues: CvReviewIssue[] } {
  const issues: CvReviewIssue[] = [];
  const allowed = allowedIds(brief);
  const facts = {
    experiences: new Map(repos.facts.experiences.list().map((e) => [e.id, e])),
    projects: new Map(repos.facts.projects.list().map((p) => [p.id, p])),
    education: new Map(repos.facts.education.list().map((e) => [e.id, e])),
  };
  const known = new Set(
    [
      ...brief.skills.map((s) => s.name),
      ...brief.experiences.flatMap((e) => e.tech),
      ...brief.projects.flatMap((p) => p.tech),
    ].map(normalizeTerm),
  );
  const used: EvidenceId[] = [];

  // dados já no idioma do documento: cargo, local e curso como estão (o gerador só traduz quando o idioma muda)
  const sameLanguage = brief.sourceLocale === brief.locale;
  const experiences: CvContent["experiences"] = [];
  for (const d of draft.experiences) {
    const b = brief.experiences.find((e) => e.id === d.factId);
    const fact = facts.experiences.get(d.factId);
    if (!b || !fact) {
      issues.push(issue(`A experiência ${d.factId} não está entre as que podem entrar no CV.`));
      continue;
    }
    const where = b.company;
    for (const bullet of d.bullets) checkRefs(bullet.factIds, allowed, where, issues);
    for (const t of d.tech)
      if (!known.has(normalizeTerm(t)))
        issues.push(issue(`A tecnologia "${t}" em ${b.company} não está nos seus dados.`, where));
    used.push({ kind: "experience", id: b.id }, ...d.bullets.flatMap((x) => x.factIds));
    experiences.push({
      factId: b.id,
      company: b.company,
      // cargo e local no idioma do documento (o revisor confere que dizem o mesmo que os dados)
      title: sameLanguage ? b.title : d.title,
      start: b.start,
      end: b.current ? null : b.end,
      location: fact.location
        ? sameLanguage
          ? fact.location
          : (d.location ?? fact.location)
        : null,
      bullets: d.bullets,
      tech: d.tech,
      matchScore: b.matchScore,
    });
  }
  experiences.sort((a, b) => (b.start ?? "").localeCompare(a.start ?? ""));

  const skillScore = new Map(brief.skills.map((s) => [s.id, s.matchScore]));
  const skillName = new Map(brief.skills.map((s) => [s.id, s.name]));
  /** Nome da skill: o dos dados, ou a tradução de uma competência que não é tecnologia (Mentoria → Mentoring). */
  const skillNameOk = (name: string, refs: EvidenceId[]) => {
    if (known.has(normalizeTerm(name))) return true;
    const own = refs.filter((r) => r.kind === "skill").map((r) => skillName.get(r.id));
    if (own.length === 0) return false;
    const asTech = canonicalTerm(name);
    return !asTech || own.some((o) => o && canonicalTerm(o)?.canonical === asTech.canonical);
  };
  const skills: CvContent["skills"] = draft.skills.map((g) => ({
    label: g.label,
    items: g.items.map((i) => {
      checkRefs(i.factIds, allowed, g.label, issues);
      if (!skillNameOk(i.name, i.factIds))
        issues.push(issue(`A skill "${i.name}" não está nos seus dados.`, g.label));
      used.push(...i.factIds);
      const s = i.factIds.find((f) => f.kind === "skill");
      return { name: i.name, factIds: i.factIds, matchScore: (s && skillScore.get(s.id)) ?? 50 };
    }),
  }));

  const projects: CvContent["projects"] = draft.projects.flatMap((d) => {
    const p = facts.projects.get(d.factId);
    if (!p || !brief.projects.some((x) => x.id === d.factId)) {
      issues.push(issue(`O projeto ${d.factId} não está entre os que podem entrar no CV.`));
      return [];
    }
    used.push({ kind: "project", id: p.id });
    return [
      { factId: p.id, name: p.name, description: d.description, url: p.url ?? null, tech: p.tech },
    ];
  });

  for (const a of draft.adjacent) {
    checkRefs(a.factIds, allowed, "adjacência", issues);
    if (termInText(aliasesOf(a.asked), a.shown))
      issues.push(
        issue(`A adjacência de "${a.asked}" usa o próprio termo que falta.`, "adjacência"),
      );
  }

  issues.push(
    ...gapIssues(brief, [
      ["resumo", draft.summary],
      ...experiences.map((e): [string, string] => [
        e.company,
        [...e.bullets.map((b) => b.text), ...e.tech].join(" \n "),
      ]),
      ["skills", skills.flatMap((g) => g.items.map((i) => i.name)).join(", ")],
      ["projetos", projects.map((p) => p.description ?? "").join(" \n ")],
    ]),
  );

  const written = new Set(experiences.map((e) => e.factId));
  const omitted: CvContent["omitted"] = [
    ...brief.omitted.map((o) => ({
      factId: o.id,
      company: o.company,
      title: o.title,
      reason: o.reason,
      matchScore: 0,
    })),
    ...brief.experiences
      .filter((e) => !written.has(e.id))
      .map((e) => ({
        factId: e.id,
        company: e.company,
        title: e.title,
        reason: `Fora do CV para caber em 2 páginas (score ${e.matchScore}).`,
        matchScore: e.matchScore,
      })),
  ];

  const translated = new Map(draft.education.map((t) => [t.factId, t]));
  const education = brief.education.map((e) => {
    const f = facts.education.get(e.id);
    const t = sameLanguage ? undefined : translated.get(e.id);
    return {
      factId: e.id,
      institution: e.institution,
      course: e.course === null ? null : (t?.course ?? e.course),
      degree: e.degree === null ? null : (t?.degree ?? e.degree),
      start: f?.startDate ?? null,
      end: f?.endDate ?? null,
    };
  });
  const languages = brief.languages.map((l) => ({
    factId: l.id,
    name: languageName(brief.locale, l.name),
    level: l.level,
  }));
  const factIdsUsed = dedupe(used);

  const content: CvContent = {
    meta: { kind: "cv", ...ctx.meta },
    header: { ...ctx.header, title: draft.headline },
    summary: draft.summary,
    experiences,
    skills: skills.filter((g) => g.items.length > 0),
    projects,
    education,
    languages,
    adjacent: draft.adjacent,
    sectionsOrder: draft.sectionsOrder,
    omitted,
    provenance: { factIdsUsed, unverifiedFactIds: unverifiedOf(repos, factIdsUsed) },
  };
  const parsed = CvContentSchema.safeParse(content);
  if (!parsed.success)
    issues.push({
      area: "facts",
      severity: "error",
      message: `Conteúdo fora do formato: ${parsed.error.issues[0]?.message ?? "inválido"}.`,
      where: null,
    });
  return { content, issues };
}

export function assembleCoverLetter(
  brief: CvBrief,
  draft: CoverLetterDraft,
  ctx: { meta: AssembleMeta & { postingId: string; format: CoverLetterFormat }; header: CvHeader },
): { content: CoverLetterContent; issues: CvReviewIssue[] } {
  const issues: CvReviewIssue[] = [];
  const allowed = allowedIds(brief);
  for (const p of draft.paragraphs) checkRefs(p.factIds, allowed, p.role, issues);
  // a carta pode citar as lacunas no parágrafo delas; no resto, termo sem evidência é alucinação
  issues.push(
    ...gapIssues(
      brief,
      draft.paragraphs
        .filter((p) => p.role !== "gaps")
        .map((p): [string, string] => [p.role, p.text]),
    ),
  );
  const content: CoverLetterContent = {
    meta: { kind: "cover_letter", ...ctx.meta },
    // título no idioma da carta (o cargo-alvo do perfil pode estar escrito em outro)
    header: draft.headline ? { ...ctx.header, title: draft.headline } : ctx.header,
    greeting: draft.greeting,
    paragraphs: draft.paragraphs,
    signature: ctx.header.name,
  };
  const words = coverLetterWordCount(content);
  if (words < 250 || words > 400)
    issues.push({
      area: "layout",
      severity: "error",
      message: `A carta tem ${words} palavras (de 250 a 400).`,
      where: null,
    });
  else {
    const parsed = CoverLetterContentSchema.safeParse(content);
    if (!parsed.success)
      issues.push({
        area: "facts",
        severity: "error",
        message: `Carta fora do formato: ${parsed.error.issues[0]?.message ?? "inválida"}.`,
        where: null,
      });
  }
  return { content, issues };
}
