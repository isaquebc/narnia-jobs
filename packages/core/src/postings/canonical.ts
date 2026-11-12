/**
 * Link canônico da vaga (F06 na extensão; F14/M4 para os links vindos de e-mail): sem rastreio, query ordenada, sem
 * barra final nem a página do formulário; host sem `www.`; LinkedIn reduzido a `linkedin.com/jobs/view/<id>` (o
 * e-mail traz `/comm/jobs/view/<id>?trackingId…&midToken…`, a página `/jobs/view/<slug>-<id>`).
 */
const TRACKING =
  /^(utm_|ref$|refid$|trk|tracking|source$|src$|gclid$|fbclid$|lipi$|origin$|midtoken$|midsig$|eid$|otptoken$|trackingid$|alertaction$|savedsearchid$)/i;

const APPLY_SUFFIX =
  /\/(application|apply|applications\/new|job_app|candidatar|candidatura|inscricao)$/i;

export function canonicalUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    const host = u.host.toLowerCase().replace(/^www\./, "");
    const li = /(^|\.)linkedin\.com$/.test(host)
      ? u.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d{6,})\/?$/)?.[1]
      : undefined;
    if (li) return `linkedin.com/jobs/view/${li}`;
    // Glassdoor (correção 2026-11-11): a vaga é o `jl`/`jobListingId`, global entre os domínios do país; o resto é rastreio
    if (/(^|\.)glassdoor\.[a-z.]+$/.test(host)) {
      const jl = u.searchParams.get("jl") ?? u.searchParams.get("jobListingId");
      if (jl && /^\d{6,}$/.test(jl)) return `glassdoor/job-listing/${jl}`;
    }
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
    // a página do formulário é a mesma vaga: Ashby /application, Lever e Gupy /apply, Greenhouse /applications/new
    const path = u.pathname.replace(/\/+$/, "").replace(APPLY_SUFFIX, "");
    return `${host}${path}${query}`;
  } catch {
    return null;
  }
}

/**
 * Preenche o link canônico das vagas antigas (F14/M4: a coluna é nova; a duplicata por link das vagas vindas de
 * e-mail compara com ela). Roda no boot do api; idempotente.
 */
export function backfillCanonicalUrls(db: {
  prepare(sql: string): { all(...a: unknown[]): unknown[]; run(...a: unknown[]): unknown };
}): number {
  const rows = db
    .prepare(
      // Glassdoor sempre de novo: a regra do `jl` é de 2026-11-11 e as vagas antigas guardaram o rastreio
      "select id, posting_url, canonical_url from posting where posting_url is not null and (canonical_url is null or posting_url like '%glassdoor.%')",
    )
    .all() as Array<{ id: string; posting_url: string; canonical_url: string | null }>;
  const set = db.prepare("update posting set canonical_url = ? where id = ?");
  let n = 0;
  for (const r of rows) {
    const c = canonicalUrl(r.posting_url);
    if (c === r.canonical_url) continue;
    set.run(c, r.id);
    n++;
  }
  return n;
}
