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
      "select id, posting_url from posting where posting_url is not null and canonical_url is null",
    )
    .all() as Array<{ id: string; posting_url: string }>;
  const set = db.prepare("update posting set canonical_url = ? where id = ?");
  for (const r of rows) set.run(canonicalUrl(r.posting_url), r.id);
  return rows.length;
}
