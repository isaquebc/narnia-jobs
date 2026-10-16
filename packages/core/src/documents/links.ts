import type { CvLink, CvLinkKind, Link } from "@narnia-jobs/shared";

/**
 * Links do cabeçalho do CV (F05-19): e-mail (`mailto:`), WhatsApp (`wa.me`), LinkedIn e GitHub pelo domínio dos links
 * cadastrados, portfólio pelo rótulo (ou o primeiro link que sobra). Só entra o que existe nos dados; o GitHub cai
 * para o dono dos repositórios ingeridos quando não há link cadastrado (o login do `gh` não é guardado).
 */
export interface HeaderLinkSource {
  email: string | null;
  phone: { e164: string } | null;
  links: Link[];
}

export const HEADER_LINK_KINDS: CvLinkKind[] = [
  "email",
  "whatsapp",
  "linkedin",
  "github",
  "portfolio",
];

const PORTFOLIO_LABEL = /portf[oó]lio|portfolio|site pessoal|personal site|website/i;

export function whatsappUrl(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, "")}`;
}

function httpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** Rótulo curto e legível no PDF: domínio sem `www.` + caminho sem a barra final. */
export function shortLabel(u: URL): string {
  const path = u.pathname.replace(/\/+$/, "");
  return `${u.hostname.replace(/^www\./, "")}${path}`;
}

const isHost = (u: URL, domain: string) =>
  u.hostname === domain || u.hostname.endsWith(`.${domain}`);

export function buildHeaderLinks(
  src: HeaderLinkSource,
  opts: { githubOwner: string | null },
): CvLink[] {
  const out: CvLink[] = [];
  if (src.email) out.push({ kind: "email", url: `mailto:${src.email}`, label: src.email });
  if (src.phone?.e164)
    out.push({ kind: "whatsapp", url: whatsappUrl(src.phone.e164), label: "WhatsApp" });
  const urls = src.links.flatMap((l) => {
    const u = httpUrl(l.url);
    return u ? [{ label: l.label, raw: l.url, u }] : [];
  });
  const linkedin = urls.find((l) => isHost(l.u, "linkedin.com"));
  if (linkedin) out.push({ kind: "linkedin", url: linkedin.raw, label: shortLabel(linkedin.u) });
  const github = urls.find((l) => isHost(l.u, "github.com"));
  if (github) out.push({ kind: "github", url: github.raw, label: shortLabel(github.u) });
  else if (opts.githubOwner)
    out.push({
      kind: "github",
      url: `https://github.com/${opts.githubOwner}`,
      label: `github.com/${opts.githubOwner}`,
    });
  const rest = urls.filter((l) => l !== linkedin && l !== github);
  const portfolio = rest.find((l) => PORTFOLIO_LABEL.test(l.label)) ?? rest[0];
  if (portfolio)
    out.push({ kind: "portfolio", url: portfolio.raw, label: shortLabel(portfolio.u) });
  return out;
}

/** Tipos de link que a tela do CV avisa que faltam (com atalho para cadastrar). */
export function missingHeaderLinks(links: CvLink[]): CvLinkKind[] {
  const have = new Set(links.map((l) => l.kind));
  return HEADER_LINK_KINDS.filter((k) => !have.has(k));
}
