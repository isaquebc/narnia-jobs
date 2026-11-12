import { domainOfAddress, platformOf } from "./domains";
import { decodeEntities, HTML_MAX, htmlToText, type ParsedMail } from "./risk";

/**
 * Leitores de alertas de vagas por código (F14/M3, plano §2.1 e M0: Glassdoor, LinkedIn e Coders são a maior parte),
 * sem tokens. Cada alerta traz vários blocos de vaga; cada bloco tem um link com o id da vaga, o cargo no texto do link
 * e, logo depois, empresa e local. O que não for reconhecido aqui vai ao modelo (M4).
 *
 * Feitos com e-mails sintéticos no formato conhecido dessas plataformas (repositório público, nada real do dono):
 * calibrar com alertas reais quando o dono autorizar (§10).
 */
export interface JobAlertItem {
  title: string;
  company: string | null;
  location: string | null;
  /** Link canônico da vaga (sem rastreio); null quando o alerta não traz link por vaga (resumo da Coders). */
  url: string | null;
  externalId: string;
}

export interface JobAlert {
  platform: "linkedin" | "glassdoor" | "coders";
  items: JobAlertItem[];
}

interface Rule {
  platform: JobAlert["platform"];
  /** Acha o id da vaga num link (já desembrulhado do redirecionamento de rastreio). */
  id: (url: URL) => string | null;
  canonical: (id: string, url: URL) => string;
}

const RULES: Rule[] = [
  {
    platform: "linkedin",
    id: (u) =>
      /(^|\.)linkedin\.com$/.test(u.hostname)
        ? (u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/)?.[1] ?? null)
        : null,
    canonical: (id) => `https://www.linkedin.com/jobs/view/${id}/`,
  },
  {
    platform: "glassdoor",
    id: (u) =>
      /(^|\.)glassdoor\.com(\.br)?$/.test(u.hostname)
        ? (u.searchParams.get("jobListingId") ??
          u.searchParams.get("jl") ??
          u.pathname
            .match(/_JV_[^/]*?(\d{6,})|-(\d{8,})\.htm/)
            ?.slice(1)
            .find(Boolean) ??
          null)
        : null,
    canonical: (id, u) =>
      `https://${u.hostname.replace(/^[^.]+\.(?=glassdoor)/, "www.")}/job-listing/j?jl=${id}`,
  },
  {
    platform: "coders",
    id: (u) =>
      /(^|\.)coders\.com\.br$/.test(u.hostname)
        ? (u.pathname.match(/^\/vagas?\/([\w-]{3,})\/?$/)?.[1] ?? null)
        : null,
    canonical: (id) => `https://coders.com.br/vagas/${id}`,
  },
];

/** Desembrulha links de rastreio (`click.…/?url=…`, `…?u=…`, `/redirect?target=…`). */
export function unwrapLink(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  for (let i = 0; i < 3; i++) {
    const inner = ["url", "u", "target", "dest", "destination", "redirect", "redirectUrl"]
      .map((k) => u.searchParams.get(k))
      .find((v) => v && /^https?:\/\//i.test(v));
    if (!inner) break;
    try {
      u = new URL(inner);
    } catch {
      break;
    }
  }
  return u;
}

const STOP_TITLES =
  /^(ver vaga|ver todas?.*|candidat(e|ar)-se|apply|view job|see all.*|saiba mais|mais detalhes|ver mais|abrir|easy apply|candidatura simplificada)$/i;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

interface Anchor {
  start: number;
  end: number;
  href: string;
  text: string;
  /** Linhas do conteúdo do link (card inteiro no link: cargo, empresa, local em linhas próprias), sem ruído. */
  lines: string[];
}

/** Linhas dos cards que não são cargo, empresa nem local ("Easy Apply", "Candidatura rápida", "2 dia(s)", salário). */
const CARD_NOISE =
  /^(easy apply|candidatura (r[áa]pida|simplificada)|promoted|promovida|actively recruiting|be an early applicant|\d+\s*dias?(\(s\))?|\d+\s*dia\(s\)|\d+\s*[hdw]|\d+\+? ?(days?|hours?|weeks?) ago|r\$.*|us?\$\s*\d.*|.*estimativa d[ao] (empresa|glassdoor).*|\d+[.,]\d\s*★)$/i;

/** Cabeçalho "vagas parecidas com a que você viu" (o link é da vaga vista, não de uma vaga nova). */
const SIMILAR_HEADER = /^(new )?(jobs|vagas) (similar|semelhantes|parecidas)/i;

/**
 * Links do HTML em uma passada (revisão do M3): cada `<a …>` abre, o próximo `</a>` fecha; sem regex com `[\s\S]*?`
 * que, com milhares de `<a>` sem fechamento, varreria o texto inteiro a cada abertura.
 */
function anchors(html: string): Anchor[] {
  const src = html.slice(0, HTML_MAX);
  const out: Anchor[] = [];
  const tag = /<(\/?)a\b([^>]*)>/gi;
  let open: { start: number; contentStart: number; href: string } | null = null;
  for (let m = tag.exec(src); m; m = tag.exec(src)) {
    if (!m[1]) {
      const href = m[2]?.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
      open = href
        ? {
            start: m.index,
            contentStart: m.index + m[0].length,
            href: decodeEntities(href[1] ?? href[2] ?? href[3] ?? ""),
          }
        : null;
    } else if (open) {
      const inner = htmlToText(src.slice(open.contentStart, m.index));
      out.push({
        start: open.start,
        end: m.index + m[0].length,
        href: open.href,
        text: clean(inner),
        lines: inner
          .split("\n")
          .map(clean)
          .filter((l) => l && !CARD_NOISE.test(l)),
      });
      open = null;
    }
  }
  return out;
}

/** Empresa e local nas linhas logo depois do cargo ("Acme · São Paulo, SP", ou uma por linha). */
function companyAndLocation(lines: string[]): { company: string | null; location: string | null } {
  const useful = lines.map(clean).filter((l) => l && !STOP_TITLES.test(l) && l.length < 120);
  const first = useful[0] ?? null;
  if (!first) return { company: null, location: null };
  const split = first.split(/\s+[·•|–-]\s+/);
  if (split.length >= 2)
    return { company: split[0] ?? null, location: split.slice(1).join(" · ") || null };
  return { company: first, location: useful[1] ?? null };
}

/** Lê um alerta de vagas; null quando o remetente não é uma das plataformas com leitor ou nada foi reconhecido. */
export function parseJobAlert(m: ParsedMail): JobAlert | null {
  const platform = platformOf(domainOfAddress(m.fromAddr));
  const rule = RULES.find((r) => r.platform === platform);
  if (!rule || !m.html) return null;
  const all = anchors(m.html);
  // agrupa os links de cada vaga (imagem, cargo, botão), na ordem em que aparecem
  const byId = new Map<string, { url: URL; anchors: Anchor[] }>();
  for (const a of all) {
    const u = unwrapLink(a.href);
    const id = u ? rule.id(u) : null;
    if (!u || !id) continue;
    const cur = byId.get(id);
    if (cur) cur.anchors.push(a);
    else byId.set(id, { url: u, anchors: [a] });
  }
  const ordered = [...byId.entries()].sort(
    (a, b) => (a[1].anchors[0]?.start ?? 0) - (b[1].anchors[0]?.start ?? 0),
  );
  const items: JobAlertItem[] = [];
  ordered.forEach(([id, g], i) => {
    const titleAnchor = g.anchors.find(
      (a) =>
        a.text.length > 2 &&
        !STOP_TITLES.test(a.text) &&
        !SIMILAR_HEADER.test(a.text) &&
        /\p{L}/u.test(a.text),
    );
    if (!titleAnchor) return;
    const url = rule.canonical(id, g.url);
    // card inteiro dentro do link (formato real visto em 2026-11-11): as linhas do próprio link
    const lines = titleAnchor.lines;
    if (lines.length >= 2) {
      if (rule.platform === "glassdoor") {
        // Glassdoor: empresa (com a nota "4.0 ★"), cargo, local
        const company = clean((lines[0] as string).replace(/\s*\d[.,]\d\s*★\s*$/, "")) || null;
        items.push({
          title: lines[1] as string,
          company,
          location: lines[2] ?? null,
          url,
          externalId: id,
        });
        return;
      }
      const { company, location } = companyAndLocation(lines.slice(1));
      items.push({ title: lines[0] as string, company, location, url, externalId: id });
      return;
    }
    const title = titleAnchor.text;
    // empresa e local: o texto logo depois do link do cargo, até o bloco da próxima vaga
    const nextStart = ordered[i + 1]?.[1].anchors[0]?.start ?? m.html.length;
    const after = htmlToText(
      m.html.slice(titleAnchor.end, Math.min(nextStart, titleAnchor.end + 2000)),
    )
      .split("\n")
      .filter((l) => clean(l) !== title);
    const { company, location } = companyAndLocation(after);
    items.push({ title, company, location, url, externalId: id });
  });
  if (!items.length && rule.platform === "coders") items.push(...codersDigest(m.html));
  return items.length ? { platform: rule.platform, items } : null;
}

/**
 * Resumo diário da Coders (correção 2026-11-11, formato real visto na caixa do dono): sem link por vaga; depois de "O
 * que chegou", cada vaga é o cargo numa linha e "Empresa · via Fonte" (ou só a empresa) na seguinte, até "E mais N
 * vagas" ou o botão do board. A vaga fica sem link (o feed mostra a origem) e o id sai da empresa e do cargo.
 */
function codersDigest(html: string): JobAlertItem[] {
  // linha a mais numa vaga (local, modo, salário) sai antes de formar os pares (revisão: senão desalinha o resto)
  const extra =
    /^(remot[oa]|remote|h[íi]brid[oa]|hybrid|presencial|on-?site|home office|r\$.*|[^,]{2,40},\s*[A-Z]{2})$/i;
  const lines = htmlToText(html)
    .split("\n")
    .map(clean)
    .filter((l) => l && !extra.test(l));
  const start = lines.findIndex((l) => /^o que chegou$/i.test(l));
  if (start < 0) return [];
  const out: JobAlertItem[] = [];
  for (let i = start + 1; i + 1 < lines.length; i += 2) {
    const title = lines[i] as string;
    const second = lines[i + 1] as string;
    if (/^e mais \d+ vagas?|^ver (as )?vagas|^se o bot[ãa]o/i.test(title)) break;
    if (/^e mais \d+ vagas?|^ver (as )?vagas/i.test(second)) break;
    // "Empresa · via Fonte", só a empresa, ou só "via Fonte" (vaga sem empresa no resumo)
    const company = /^via\s/i.test(second)
      ? null
      : clean(second.split(/\s+·\s+via\s+/i)[0] ?? "") || null;
    if (title.length > 160 || (company?.length ?? 0) > 80) break;
    const key = `${company ?? ""} ${title}`
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 120);
    out.push({ title, company, location: null, url: null, externalId: `digest-${key}` });
  }
  return out;
}
