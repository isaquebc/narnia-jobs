import type { Posting } from "@narnia-jobs/shared";
import { COMPANY_GENERIC_NAME, companyKey, normalizeIdentityPart, sameTitle } from "./identity";

/**
 * Vagas iguais num card só (pedido do dono 2026-11-12): mesma empresa e mesmo cargo, com links diferentes (o LinkedIn
 * repete a vaga por país; os alertas repetem a mesma vaga). Mesmo sem descrição, agrupa; com descrição nas duas, só se
 * o texto for o mesmo (sem formatação, espaço nem pontuação). A vaga que a pessoa separou nunca entra.
 */

/** Texto da descrição sem formatação: "Requisitos:\n- Java" = "requisitos java". */
export function descriptionKey(text: string | null | undefined): string {
  return normalizeIdentityPart(text).replace(/ /g, "");
}

const fits = (a: Posting, b: Posting) => {
  if (!sameTitle(a.title, b.title)) return false;
  const da = descriptionKey(a.jdText);
  const db = descriptionKey(b.jdText);
  return !da || !db || da === db;
};

/**
 * Grupo de cada vaga (id da primeira do grupo, na ordem da lista); vaga sozinha não aparece. Uma vaga entra no
 * primeiro grupo em que combina com todas (assim duas descrições diferentes nunca se juntam por uma sem descrição).
 */
export function groupPostings(postings: Posting[]): Map<string, string> {
  const groups = new Map<string, Posting[][]>();
  for (const p of postings) {
    const key = companyKey(p.company);
    if (!key || COMPANY_GENERIC_NAME.test(key) || p.groupSplit) continue;
    const list = groups.get(key) ?? [];
    const home = list.find((g) => g.every((x) => fits(x, p)));
    if (home) home.push(p);
    else list.push([p]);
    groups.set(key, list);
  }
  const out = new Map<string, string>();
  for (const list of groups.values())
    for (const g of list) if (g.length > 1) for (const p of g) out.set(p.id, (g[0] as Posting).id);
  return out;
}
