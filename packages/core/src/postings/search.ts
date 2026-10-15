import type { Posting } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import { normalizeIdentityPart } from "./identity";
import { ROLE_LABELS } from "./tools";

/**
 * Busca por texto das vagas (página Vagas e `posting.search`, correções de 2026-10-15): empresa, cliente, cargo, role
 * (slug e rótulo em pt-BR) e nomes dos contatos. Caixa, acentos e pontuação não contam; com várias palavras, todas
 * precisam aparecer em algum campo. Busca vazia devolve todas, mais recentes primeiro.
 */
export function searchPostings(repos: Repos, query: string): Posting[] {
  const all = repos.postings.list();
  const words = normalizeIdentityPart(query).split(" ").filter(Boolean);
  if (words.length === 0) return all;
  return all.filter((p) => {
    const hay = normalizeIdentityPart(
      [
        p.company,
        p.client,
        p.title,
        p.role,
        p.role ? ROLE_LABELS[p.role] : null,
        ...repos.postingContacts.list(p.id).map((c) => c.name),
      ]
        .filter(Boolean)
        .join(" "),
    );
    return words.every((w) => hay.includes(w));
  });
}

/**
 * Vagas parecidas já registradas (alerta da página da vaga, F06-11): mesmo role e a mesma empresa, comparando
 * contratante e cliente nos dois sentidos (consultoria e cliente final). Sem empresa ou sem role não há comparação.
 */
export function relatedPostings(repos: Repos, posting: Posting): Posting[] {
  const names = (p: Pick<Posting, "company" | "client">) =>
    [p.company, p.client].map(normalizeIdentityPart).filter(Boolean);
  const mine = new Set(names(posting));
  if (mine.size === 0 || !posting.role) return [];
  return repos.postings
    .list()
    .filter(
      (p) => p.id !== posting.id && p.role === posting.role && names(p).some((n) => mine.has(n)),
    );
}
