import type { FactSearchKind } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import { type FactAlias, normalizeAliasTerm } from "../db/repos/chat";
import { canonicalTerm, normalizeTerm } from "../postings/dictionary";

/**
 * Expansão da consulta do recrutador (F04-fix-fundamentacao, R1, FF-1): as palavras que contam (sem as vazias), a frase
 * inteira quando curta, o termo canônico e os sinônimos/traduções do dicionário das vagas para cada trecho de 1 a 4
 * palavras, os pares de conceito pt/en que o dicionário das vagas não tem e o radical (5 letras) das palavras longas.
 */
const STOPWORDS = new Set(
  (
    "a o as os um uma uns umas de da do das dos em na no nas nos por para pra com sem sobre e ou que se como " +
    "mais menos muito meu minha meus minhas seu sua the an of in on at to for with and or is are my your"
  ).split(" "),
);

/** Conceitos pt/en que a busca de fatos precisa e que não são termos de vaga (o dicionário das vagas não tem). */
const CONCEPTS: string[][] = [
  ["lideranca", "leadership", "lider", "liderou", "liderar", "lead"],
  ["mentoria", "mentoring", "mentorship", "mentor"],
  ["testes", "testing", "tests", "test"],
  ["pagamentos", "payments", "payment"],
  ["entregas", "delivery", "logistica", "logistics"],
  ["educacao", "education", "ensino"],
];

const words = (s: string) => normalizeAliasTerm(s).split(" ").filter(Boolean);

export function expandQuery(q: string): string[] {
  const all = words(q);
  const content = all.filter((w) => !STOPWORDS.has(w));
  const out = new Set<string>(content);
  if (all.length > 1 && all.length <= 5) out.add(all.join(" "));
  for (let n = Math.min(4, all.length); n >= 1; n--)
    for (let i = 0; i + n <= all.length; i++) {
      const gram = all.slice(i, i + n).join(" ");
      const term = canonicalTerm(gram);
      if (!term) continue;
      for (const t of [term.canonical, ...term.aliases].slice(0, 10)) out.add(normalizeTerm(t));
    }
  for (const w of content) {
    for (const group of CONCEPTS) if (group.includes(w)) for (const c of group) out.add(c);
    if (w.length >= 7) out.add(`${w.slice(0, 5)}*`);
  }
  return [...out].filter((t) => t.replace("*", "").length >= 2);
}

/** Os termos normalizados da consulta para achar os apelidos aprendidos (a consulta inteira e cada palavra). */
export const aliasKeys = (q: string) => [normalizeAliasTerm(q), ...words(q)];

/** Rótulo curto de um fato para a tela dos termos aprendidos; null se o fato não existe mais (apelido órfão). */
export function factLabel(repos: Repos, kind: FactSearchKind, id: string): string | null {
  const f = repos.facts;
  switch (kind) {
    case "experience": {
      const e = f.experiences.get(id);
      return e ? `${e.company} · ${e.title}` : null;
    }
    case "achievement":
      return f.achievements.get(id)?.text ?? null;
    case "project":
      return f.projects.get(id)?.name ?? null;
    case "skill":
      return f.skills.get(id)?.name ?? null;
    case "education": {
      const e = f.education.get(id);
      return e ? `${e.institution} · ${e.course}` : null;
    }
    case "language":
      return f.languages.get(id)?.name ?? null;
    case "file":
      return (
        repos.sourceFiles.get(id)?.originalName ??
        (repos.sourceFiles.get(id) ? "Texto livre" : null)
      );
    case "repo":
      return repos.repos.get(id)?.fullName ?? null;
  }
}

/** Termos aprendidos (FF-1) com o rótulo do fato, para Configurações › Chat. */
export function listFactAliases(repos: Repos): Array<FactAlias & { factLabel: string | null }> {
  return repos.factAliases
    .list()
    .map((a) => ({ ...a, factLabel: factLabel(repos, a.kind, a.factId) }));
}
