import { type AnalyzeProfilesInput, AnalyzeProfilesInputSchema } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import { type CallEstimate, estimateCall, PROMPT_OVERHEAD } from "../estimate";
import { collectFactSets } from "./relevance";

/**
 * Entrada compacta de "Analisar possíveis perfis" (F02 §2.6): todo o histórico em uma linha por item, sem itens
 * ocultos em qualquer perfil, sem fatos duplicados, com digests, perfis existentes e títulos dispensados.
 */
const period = (start?: string, end?: string, current = false) =>
  `${start ?? "?"}–${current ? "atual" : (end ?? "?")}`;

export function buildAnalyzeInput(repos: Repos): AnalyzeProfilesInput {
  const facts = collectFactSets(repos);
  const profiles = repos.profiles.list({ includeArchived: true });
  const hidden = new Set<string>();
  for (const p of profiles) {
    for (const e of repos.emphasis.list(p.id)) {
      if (e.mode === "hidden") hidden.add(`${e.factKind}:${e.factId}`);
    }
  }
  const visible = (kind: string, id: string) => !hidden.has(`${kind}:${id}`);
  const user = repos.users.get();

  const experiences = facts.experiences
    .filter((e) => visible("experience", e.id))
    .map((e) => ({
      id: e.id,
      company: e.company,
      title: e.title,
      period: period(e.startDate, e.endDate, e.isCurrent),
      ...(e.summary ? { summary: e.summary } : {}),
      tech: e.tech,
      achievements: facts.achievements
        .filter((a) => a.experienceId === e.id && visible("achievement", a.id))
        .map((a) => ({ id: a.id, text: a.text, ...(a.metric ? { metric: a.metric } : {}) })),
    }));

  const input: AnalyzeProfilesInput = {
    identity: {
      name: user?.fullName ?? user?.displayName ?? "Usuário",
      ...(user?.city ? { city: user.city } : {}),
      ...(user?.country ? { country: user.country } : {}),
      ...(user?.remotePref ? { remotePref: user.remotePref } : {}),
    },
    experiences,
    projects: facts.projects
      .filter((p) => visible("project", p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        ...(p.description ? { description: p.description } : {}),
        tech: p.tech,
      })),
    education: facts.education
      .filter((ed) => visible("education", ed.id))
      .map((ed) => ({
        id: ed.id,
        institution: ed.institution,
        course: ed.course,
        ...(ed.degree ? { degree: ed.degree } : {}),
        ...(ed.startDate || ed.endDate ? { period: period(ed.startDate, ed.endDate) } : {}),
      })),
    skills: facts.skills
      .filter((s) => visible("skill", s.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        ...(s.level !== undefined ? { level: s.level } : {}),
      })),
    languages: facts.languages
      .filter((l) => visible("language", l.id))
      .map((l) => ({ id: l.id, name: l.name, level: l.level })),
    digests: repos.sourceFiles
      .list()
      .map((f) => ({ f, d: repos.digests.get(f.id) }))
      .filter((x): x is { f: (typeof x)["f"]; d: NonNullable<(typeof x)["d"]> } => Boolean(x.d))
      .map(({ f, d }) => ({ fileName: f.originalName ?? f.id, summary: d.summary })),
    existingProfiles: profiles.map((p) => ({
      name: p.name,
      targetTitle: p.targetTitle,
      seniority: p.seniority,
      area: p.area,
    })),
    dismissedTitles: repos.suggestions.dismissedTitles(),
  };
  return AnalyzeProfilesInputSchema.parse(input);
}

/** Estimativa da chamada com o tamanho real da entrada (F02 §2.9-7). */
export function estimateAnalyze(input: AnalyzeProfilesInput, model: string): CallEstimate {
  return estimateCall({
    inputChars: JSON.stringify(input).length,
    overhead: PROMPT_OVERHEAD.analyzeProfiles,
    model,
  });
}
