import type { Posting } from "@narnia-jobs/shared";
import { normalizeIdentityPart } from "../postings/identity";

/**
 * Vaga provavelmente já salva (F12/M2), sem tokens: mesmo link ou mesma empresa e cargo. A janela só avisa e oferece
 * abrir a salva; a duplicata de verdade continua com a F06 (F06-9) depois de salvar.
 */

/** Parâmetros de rastreio que não mudam a vaga. */
const TRACKING = /^(utm_|ref$|refid$|trk|tracking|source$|src$|gclid$|fbclid$|lipi$|origin$)/i;

function canonicalUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
    return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${query}`;
  } catch {
    return null;
  }
}

export function samePostingUrl(a: string, b: string): boolean {
  const x = canonicalUrl(a);
  return x !== null && x === canonicalUrl(b);
}

export function findLikelyPosting(
  postings: Posting[],
  page: { url: string; title?: string | null; company?: string | null },
): Posting | null {
  const byUrl = postings.find((p) => p.postingUrl && samePostingUrl(p.postingUrl, page.url));
  if (byUrl) return byUrl;
  const title = key(page.title);
  const company = key(page.company);
  if (!title || !company) return null;
  return postings.find((p) => key(p.title) === title && key(p.company) === company) ?? null;
}

/** Sem caixa, acento, pontuação nem espaço: "Acme S.A." = "ACME SA". */
const key = (v: string | null | undefined) => normalizeIdentityPart(v).replace(/ /g, "");
