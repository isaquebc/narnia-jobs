import type { Repos } from "../db";

/**
 * Índice dos fatos no contexto do recrutador (F04-fix-fundamentacao, R2, FF-6): todos os fatos do usuário, uma linha
 * cada, para ele não afirmar a ausência do que está registrado. Os fatos são do usuário e o perfil é o viés: entra tudo,
 * na ordem da relevância do perfil ativo. Com teto de tamanho, o fim é cortado e o resto fica para a `fact_search`.
 */
const DEFAULT_MAX_CHARS = 12_000;

const span = (a?: string | null, b?: string | null, current?: boolean) =>
  a ? `${a}–${b ?? (current ? "atual" : a)}` : "";

export function factIndexText(repos: Repos, o: { maxChars?: number } = {}): string {
  const f = repos.facts;
  const active = repos.profiles.active();
  const score = new Map<string, number>();
  if (active)
    for (const r of repos.relevance.listByProfile(active.id))
      score.set(`${r.factKind}:${r.factId}`, r.score);
  const byRelevance = <T extends { id: string }>(kind: string, list: T[]) =>
    list
      .map((x, i) => ({ x, i, s: score.get(`${kind}:${x.id}`) ?? -1 }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((e) => e.x);

  // cada entrada é um bloco que entra inteiro ou fica de fora, com o número de fatos que traz
  const entries: Array<{ text: string; facts: number }> = [];
  for (const e of byRelevance("experience", f.experiences.list())) {
    const achievements = f.achievements.listByExperience(e.id);
    entries.push({
      text: [
        `- ${[e.company, e.title, span(e.startDate, e.endDate, e.isCurrent)].filter(Boolean).join(" · ")}`,
        ...achievements.map((a) => `  - ${a.text}${a.metric ? ` (${a.metric})` : ""}`),
      ].join("\n"),
      facts: 1 + achievements.length,
    });
  }
  const skills = byRelevance("skill", f.skills.list());
  if (skills.length)
    entries.push({
      text: `- Skills: ${skills.map((s) => (s.level ? `${s.name} (${s.level})` : s.name)).join(", ")}`,
      facts: skills.length,
    });
  const languages = f.languages.list();
  if (languages.length)
    entries.push({
      text: `- Idiomas: ${languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(", ")}`,
      facts: languages.length,
    });
  for (const e of byRelevance("education", f.education.list()))
    entries.push({
      text: `- ${[e.institution, e.course, e.degree, span(e.startDate, e.endDate)].filter(Boolean).join(" · ")}`,
      facts: 1,
    });
  for (const p of byRelevance("project", f.projects.list()))
    entries.push({
      text: `- ${[p.name, p.description, span(p.startDate, p.endDate)].filter(Boolean).join(" · ")}`,
      facts: 1,
    });

  const max = o.maxChars ?? DEFAULT_MAX_CHARS;
  const head =
    "### Índice dos seus fatos\nTodos os fatos registrados do usuário (o perfil só muda o destaque). Antes de dizer que algo não está aqui, busque com `fact_search`.";
  const out: string[] = [head];
  let size = head.length;
  let left = 0;
  for (const e of entries) {
    if (left === 0 && size + e.text.length + 1 <= max) {
      out.push(e.text);
      size += e.text.length + 1;
    } else left += e.facts;
  }
  if (left > 0) out.push(`- … e mais ${left} fatos: use fact_search para achá-los.`);
  return out.join("\n");
}
