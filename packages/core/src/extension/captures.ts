import type { Posting } from "@narnia-jobs/shared";
import { normalizeIdentityPart } from "../postings/identity";

/**
 * Vaga provavelmente já salva (F12/M2), sem tokens: mesmo link ou mesma empresa e cargo. A janela só avisa e oferece
 * abrir a salva; a duplicata de verdade continua com a F06 (F06-9) depois de salvar.
 */

/** Parâmetros de rastreio que não mudam a vaga. */
const TRACKING = /^(utm_|ref$|refid$|trk|tracking|source$|src$|gclid$|fbclid$|lipi$|origin$)/i;

const APPLY_SUFFIX =
  /\/(application|apply|applications\/new|job_app|candidatar|candidatura|inscricao)$/i;

function canonicalUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
    // a página do formulário é a mesma vaga: Ashby /application, Lever e Gupy /apply, Greenhouse /applications/new
    const path = u.pathname.replace(/\/+$/, "").replace(APPLY_SUFFIX, "");
    return `${u.host.toLowerCase()}${path}${query}`;
  } catch {
    return null;
  }
}

export function samePostingUrl(a: string, b: string): boolean {
  const x = canonicalUrl(a);
  return x !== null && x === canonicalUrl(b);
}

/** Ids de vaga no link (UUID em qualquer lugar, inclusive dentro de outro link na query). */
function jobIds(raw: string): string[] {
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    // link mal codificado: usa como veio
  }
  return [...text.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)].map(
    (m) => m[0].toLowerCase(),
  );
}

/**
 * Vaga provavelmente já salva, sem tokens, do mais certo para o menos: mesmo link (sem rastreio; a página do
 * formulário conta como a da vaga), o mesmo id da vaga (UUID) dentro de outro link, mesma empresa e cargo e, por fim,
 * cargo e empresa da vaga salva no título da página ou no cargo lido (o modelo às vezes encurta o cargo:
 * "Senior Software Engineer - Vitalis Labs" × "Senior Software Engineer"). Cargo sem a empresa não basta.
 */
export function findLikelyPosting(
  postings: Posting[],
  page: {
    url: string;
    title?: string | null;
    company?: string | null;
    /** Título da aba (`document.title`), ex.: "Senior Software Engineer - Vitalis Labs @ Vitalis". */
    pageTitle?: string | null;
  },
): Posting | null {
  const byUrl = postings.find((p) => p.postingUrl && samePostingUrl(p.postingUrl, page.url));
  if (byUrl) return byUrl;
  const ids = new Set(jobIds(page.url));
  if (ids.size) {
    const byId = postings.find((p) => p.postingUrl && jobIds(p.postingUrl).some((x) => ids.has(x)));
    if (byId) return byId;
  }
  const title = key(page.title);
  const company = key(page.company);
  if (title && company) {
    const exact = postings.find((p) => key(p.title) === title && key(p.company) === company);
    if (exact) return exact;
  }
  const haystack = `${title}|${company}|${key(page.pageTitle)}`;
  return (
    postings.find((p) => {
      const pt = key(p.title);
      const pc = key(p.company);
      if (pt.length < 8 || pc.length < 2) return false;
      const companyOk = company === pc || haystack.includes(pc);
      return companyOk && (haystack.includes(pt) || (title.length > 0 && pt.includes(title)));
    }) ?? null
  );
}

/** Sem caixa, acento, pontuação nem espaço: "Acme S.A." = "ACME SA". */
const key = (v: string | null | undefined) => normalizeIdentityPart(v).replace(/ /g, "");
