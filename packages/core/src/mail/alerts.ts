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
  /** Link canônico da vaga (sem rastreio). */
  url: string;
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
        ? (u.pathname.match(/\/vagas?\/([\w-]{3,})/)?.[1] ?? null)
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
}

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
      out.push({
        start: open.start,
        end: m.index + m[0].length,
        href: open.href,
        text: clean(htmlToText(src.slice(open.contentStart, m.index))),
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
      (a) => a.text.length > 2 && !STOP_TITLES.test(a.text) && /\p{L}/u.test(a.text),
    );
    if (!titleAnchor) return;
    const title = titleAnchor.text;
    // empresa e local: o texto logo depois do link do cargo, até o bloco da próxima vaga
    const nextStart = ordered[i + 1]?.[1].anchors[0]?.start ?? m.html.length;
    const after = htmlToText(
      m.html.slice(titleAnchor.end, Math.min(nextStart, titleAnchor.end + 2000)),
    )
      .split("\n")
      .filter((l) => clean(l) !== title);
    const { company, location } = companyAndLocation(after);
    items.push({ title, company, location, url: rule.canonical(id, g.url), externalId: id });
  });
  return items.length ? { platform: rule.platform, items } : null;
}
