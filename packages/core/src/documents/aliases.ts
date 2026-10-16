import type { CoverLetterDraft, CvBrief, CvDraft, EvidenceId } from "@narnia-jobs/shared";

/**
 * IDs curtos para o gerador (F05): os fatos têm UUIDv7, longos e quase iguais (mesmo prefixo de tempo), e o modelo
 * chegou a misturar dois deles numa origem, o que descartava a tentativa. O gerador recebe `e1`, `a3`, `s12`, `p1`, `ed1`,
 * `l1`; a resposta volta com os ids reais. Id curto desconhecido fica como veio, e a montagem aponta a origem inválida.
 */
const PREFIX: Record<string, string> = {
  experience: "e",
  achievement: "a",
  skill: "s",
  project: "p",
  education: "ed",
  language: "l",
};

export interface BriefAliases {
  brief: CvBrief;
  restoreCv(draft: CvDraft): CvDraft;
  restoreLetter(draft: CoverLetterDraft): CoverLetterDraft;
}

export function aliasBriefIds(brief: CvBrief): BriefAliases {
  const toShort = new Map<string, string>();
  const toReal = new Map<string, string>();
  const count = new Map<string, number>();
  const alias = (kind: string, id: string): string => {
    const prefix = PREFIX[kind];
    if (!prefix) return id;
    const key = `${kind}:${id}`;
    const known = toShort.get(key);
    if (known) return known;
    const n = (count.get(kind) ?? 0) + 1;
    count.set(kind, n);
    const short = `${prefix}${n}`;
    toShort.set(key, short);
    toReal.set(`${kind}:${short}`, id);
    return short;
  };
  const real = (kind: string, id: string) => toReal.get(`${kind}:${id}`) ?? id;
  const refs = (list: EvidenceId[], map: (k: string, id: string) => string) =>
    list.map((r) => ({ ...r, id: map(r.kind, r.id) }));

  const experiences = brief.experiences.map((e) => ({
    ...e,
    id: alias("experience", e.id),
    achievements: e.achievements.map((a) => ({ ...a, id: alias("achievement", a.id) })),
  }));
  const short: CvBrief = {
    ...brief,
    experiences,
    omitted: brief.omitted.map((o) => ({ ...o, id: alias("experience", o.id) })),
    skills: brief.skills.map((s) => ({ ...s, id: alias("skill", s.id) })),
    projects: brief.projects.map((p) => ({ ...p, id: alias("project", p.id) })),
    education: brief.education.map((e) => ({ ...e, id: alias("education", e.id) })),
    languages: brief.languages.map((l) => ({ ...l, id: alias("language", l.id) })),
    posting: brief.posting && {
      ...brief.posting,
      analysis: brief.posting.analysis && {
        ...brief.posting.analysis,
        matches: brief.posting.analysis.matches.map((m) => ({
          ...m,
          evidence: m.evidence.map((r) => ({ ...r, id: alias(r.kind, r.id) })),
        })),
      },
    },
  };
  // apontamentos da tentativa anterior citam ids reais ("A experiência <id> não está…")
  const ids = [...toShort].map(([key, sh]) => [key.slice(key.indexOf(":") + 1), sh] as const);
  short.previousIssues = brief.previousIssues.map((i) => ({
    ...i,
    message: ids.reduce((m, [id, sh]) => m.replaceAll(id, sh), i.message),
  }));
  return {
    brief: short,
    restoreCv: (d) => ({
      ...d,
      experiences: d.experiences.map((e) => ({
        ...e,
        factId: real("experience", e.factId),
        bullets: e.bullets.map((b) => ({ ...b, factIds: refs(b.factIds, real) })),
      })),
      education: d.education.map((e) => ({ ...e, factId: real("education", e.factId) })),
      skills: d.skills.map((g) => ({
        ...g,
        items: g.items.map((i) => ({ ...i, factIds: refs(i.factIds, real) })),
      })),
      projects: d.projects.map((p) => ({ ...p, factId: real("project", p.factId) })),
      adjacent: d.adjacent.map((a) => ({ ...a, factIds: refs(a.factIds, real) })),
    }),
    restoreLetter: (d) => ({
      ...d,
      paragraphs: d.paragraphs.map((p) => ({ ...p, factIds: refs(p.factIds, real) })),
    }),
  };
}
