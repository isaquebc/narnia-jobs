import { simpleParser } from "mailparser";
import type { MailSendersRepo } from "../db";
import {
  ATS_PLATFORMS,
  brandInName,
  domainOfAddress,
  isWebmail,
  lookalikeOf,
  platformOf,
  registrableDomain,
  SHORTENERS,
} from "./domains";

/**
 * Risco do e-mail e confiabilidade do remetente (F14-13, plans/plan-v0/tasks/F14-leitura-de-emails.md §2.7), tudo
 * por código e antes de qualquer outro passo: autenticação (SPF/DKIM/DMARC do Gmail), domínio parecido com o de uma
 * plataforma, marca no nome com domínio de outra, `Reply-To` em outro domínio, links e anexos perigosos, termos de
 * golpe de vaga, a lista da pessoa (confiar/bloquear) e o histórico do remetente.
 */
export type RiskLevel = "trusted" | "neutral" | "high";

export interface ParsedMail {
  fromAddr: string | null;
  fromName: string | null;
  replyTo: string | null;
  subject: string;
  text: string;
  html: string;
  links: string[];
  attachments: Array<{ filename: string; contentType: string; size: number; content: Buffer }>;
  authResults: string[];
  /** `Message-ID`, para achar o e-mail no Gmail. */
  messageId: string | null;
}

/** Entidades HTML nomeadas comuns e todas as numéricas (`&#104;`, `&#x68;`). */
export function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
    // correção 2026-11-11: o LinkedIn separa empresa e local com `&middot;`
    middot: "·",
    bull: "•",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    lsquo: "‘",
    rsquo: "’",
    ldquo: "“",
    rdquo: "”",
    copy: "©",
    reg: "®",
    trade: "™",
    aacute: "á",
    eacute: "é",
    iacute: "í",
    oacute: "ó",
    uacute: "ú",
    agrave: "à",
    acirc: "â",
    ecirc: "ê",
    ocirc: "ô",
    atilde: "ã",
    otilde: "õ",
    ccedil: "ç",
    uuml: "ü",
    Aacute: "Á",
    Eacute: "É",
    Iacute: "Í",
    Oacute: "Ó",
    Uacute: "Ú",
    Atilde: "Ã",
    Ccedil: "Ç",
  };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return named[e] ?? named[e.toLowerCase()] ?? m;
  });
}

/** Teto do HTML lido por código (revisão do M3: regex em HTML hostil de vários MB travaria o worker). */
export const HTML_MAX = 512 * 1024;

/** Links do HTML (`href` com aspas ou sem) e do texto, sem repetir e sem `mailto:`/`javascript:`. */
export function extractLinks(html: string, text: string): string[] {
  const out = new Set<string>();
  for (const m of html
    .slice(0, HTML_MAX)
    .matchAll(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    const href = decodeEntities(m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (/^https?:\/\//i.test(href)) out.add(href);
  }
  for (const m of text.slice(0, HTML_MAX).matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) out.add(m[0]);
  return [...out];
}

/** Remove blocos `<style>`, `<script>` e `<head>` em tempo linear (cada fechamento é procurado uma vez). */
function dropBlocks(html: string): string {
  let out = "";
  let pos = 0;
  const open = /<(style|script|head)\b/gi;
  while (true) {
    open.lastIndex = pos;
    const m = open.exec(html);
    if (!m) break;
    out += html.slice(pos, m.index);
    const close = html.toLowerCase().indexOf(`</${(m[1] as string).toLowerCase()}`, m.index);
    if (close < 0) return `${out} `;
    const end = html.indexOf(">", close);
    pos = end < 0 ? html.length : end + 1;
    out += " ";
  }
  return out + html.slice(pos);
}

/** Texto de um HTML de e-mail: sem estilos, scripts e tags, com quebras nos blocos e entidades decodificadas. */
export function htmlToText(html: string): string {
  return decodeEntities(
    dropBlocks(html.slice(0, HTML_MAX))
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|table|td)>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n[ \n]*/g, "\n")
    .trim();
}

/** E-mail inteiro (corpo, links, anexos e autenticação) para o risco e os leitores por código. */
export async function parseMail(raw: Buffer): Promise<ParsedMail> {
  const p = await simpleParser(raw, { skipImageLinks: true });
  const html = typeof p.html === "string" ? p.html : "";
  // e-mail só com HTML: o texto vem do HTML (o golpe e o modelo leem o texto). Texto puro bem mais pobre que o HTML
  // também (Indeed, 2026-11-12: a empresa e o cargo só estão no HTML; o texto puro é o rodapé)
  const fromHtml = html ? htmlToText(html) : "";
  const plain = p.text?.trim() ?? "";
  const text =
    plain && plain.length * 2 >= fromHtml.trim().length ? (p.text as string) : fromHtml || plain;
  return {
    fromAddr: p.from?.value?.[0]?.address?.toLowerCase() ?? null,
    fromName: p.from?.value?.[0]?.name || null,
    replyTo: p.replyTo?.value?.[0]?.address?.toLowerCase() ?? null,
    subject: p.subject ?? "",
    text,
    html,
    links: extractLinks(html, text),
    attachments: (p.attachments ?? []).map((a) => ({
      filename: a.filename ?? "",
      contentType: a.contentType ?? "application/octet-stream",
      size: a.size ?? a.content?.length ?? 0,
      content: a.content,
    })),
    authResults: (p.headerLines ?? [])
      .filter((h) => h.key === "authentication-results")
      .map((h) => h.line.replace(/^authentication-results:\s*/i, "").replace(/\r?\n\s+/g, " ")),
    messageId: p.messageId ?? null,
  };
}

export interface AuthVerdict {
  present: boolean;
  spf: string | null;
  dmarc: string | null;
  dkimPassDomains: string[];
  /** Domínio do envelope (`smtp.mailfrom`), registrável. */
  spfDomain: string | null;
  /** DMARC aprovado, ou DKIM/SPF aprovado no mesmo domínio registrável do `From`. */
  aligned: boolean;
  /** Nada falhou de forma que indique remetente falso (DMARC fail, ou SPF fail sem DKIM nenhum). */
  ok: boolean;
}

/** Domínio de `header.d`, `header.i` (`@d` ou `user@d`) ou `smtp.mailfrom` (`user@d` ou `d`). */
const domainOfProp = (v: string) => registrableDomain(v.slice(v.lastIndexOf("@") + 1));

/**
 * Lê o `Authentication-Results` do Gmail (revisão do M3): só o primeiro cabeçalho (o Gmail grava o dele no topo; os
 * de baixo podem ter vindo do remetente) e só se o servidor for exatamente `mx.google.com`; comentários entre
 * parênteses (onde fica o resumo do ARC de terceiros) são descartados antes de ler cada resultado.
 */
export function authVerdict(authResults: string[], fromDomain: string | null): AuthVerdict {
  const first = authResults[0]?.trim() ?? "";
  const none: AuthVerdict = {
    present: false,
    spf: null,
    dmarc: null,
    dkimPassDomains: [],
    spfDomain: null,
    aligned: false,
    ok: false,
  };
  if (!/^mx\.google\.com\s*;/i.test(first)) return none;
  let clean = first;
  while (/\([^()]*\)/.test(clean)) clean = clean.replace(/\([^()]*\)/g, " ");
  const resinfos = clean
    .split(";")
    .slice(1)
    .map((r) => r.trim())
    .filter(Boolean);
  let spf: string | null = null;
  let dmarc: string | null = null;
  let spfDomain: string | null = null;
  const dkimPassDomains: string[] = [];
  for (const r of resinfos) {
    const m = r.match(/^([a-z-]+)\s*=\s*([a-z]+)/i);
    if (!m) continue;
    const method = (m[1] as string).toLowerCase();
    const result = (m[2] as string).toLowerCase();
    const prop = (k: string) =>
      r.match(new RegExp(`\\b${k.replace(".", "\\.")}=([^\\s;]+)`, "i"))?.[1] ?? null;
    if (method === "spf" && spf === null) {
      spf = result;
      const mf = prop("smtp.mailfrom");
      spfDomain = mf ? domainOfProp(mf) : null;
    } else if (method === "dmarc" && dmarc === null) dmarc = result;
    else if (method === "dkim" && result === "pass") {
      const d = prop("header.d") ?? prop("header.i");
      if (d) dkimPassDomains.push(domainOfProp(d));
    }
  }
  const fromReg = fromDomain ? registrableDomain(fromDomain) : null;
  const aligned =
    dmarc === "pass" ||
    (!!fromReg && (dkimPassDomains.includes(fromReg) || (spf === "pass" && spfDomain === fromReg)));
  const spfFailed = spf === "fail" || spf === "softfail";
  return {
    present: true,
    spf,
    dmarc,
    dkimPassDomains,
    spfDomain,
    aligned,
    ok: dmarc !== "fail" && !(spfFailed && dkimPassDomains.length === 0),
  };
}

const DANGEROUS_EXT =
  /\.(exe|scr|bat|cmd|com|js|jse|vbs|vbe|wsf|msi|jar|ps1|html?|zip|rar|7z|iso|img|docm|xlsm|pptm|lnk|hta|apk)$/i;

/**
 * Golpes de vaga (pt e en): pedidos de dinheiro e dados, não palavras soltas (revisão do M3: "Squad Pix" num alerta
 * de vaga de fintech não é golpe).
 */
const SCAM = [
  /(pagu?e|pagamento|transfer|envie|deposit|fa[çc]a)[^.\n]{0,40}\bpix\b/i,
  /\bpix\b[^.\n]{0,40}(taxa|valor de|R\$)/i,
  /taxa de (inscri[çc][ãa]o|cadastro|matr[íi]cula|ades[ãa]o)/i,
  /(pagamento|dep[óo]sito) antecipad/i,
  /(envie|informe|mande)[^.\n]{0,30}(seus )?dados banc[áa]rios/i,
  /curso (pago|obrigat[óo]rio)/i,
  /renda extra/i,
  /\b(registration|processing|application|training) fee\b/i,
];

export interface SenderIdentity {
  /** Endereço do remetente (chave da lista por endereço). */
  address: string | null;
  domain: string | null;
  kind: "platform" | "webmail" | "other";
  platform: string | null;
}

export interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
  sender: SenderIdentity;
  auth: AuthVerdict;
  /** De onde veio a confiança (para a tela): lista da pessoa, plataforma autenticada ou histórico. */
  trustedBy: "list" | "platform" | "history" | "applied" | null;
}

/**
 * A escolha da pessoa para o remetente: pelo endereço, senão pelo domínio exato e cada domínio acima dele até o
 * registrável (`@mail.acme.com` vale para `x@a.mail.acme.com`, como no reprocessamento; revisão do M3).
 */
export function senderOverride(senders: MailSendersRepo, address: string | null) {
  if (!address) return null;
  const domain = domainOfAddress(address);
  const candidates = [address];
  if (domain) {
    const reg = registrableDomain(domain);
    const parts = domain.split(".");
    for (let i = 0; i < parts.length; i++) {
      const d = parts.slice(i).join(".");
      candidates.push(`@${d}`);
      if (d === reg) break;
    }
  }
  for (const v of candidates) {
    const r = senders.get(v);
    if (r?.override) return r;
  }
  return null;
}

export function assessMailRisk(
  m: ParsedMail,
  senders: MailSendersRepo,
  /**
   * Domínios (registráveis) dos sites das vagas em que a pessoa se candidatou (pedido do dono 2026-11-12): o remetente
   * desses domínios, com a autenticação alinhada, é confiável, e o `Reply-To` para eles não é risco.
   */
  appliedDomains: ReadonlySet<string> = new Set(),
): RiskAssessment {
  const domain = domainOfAddress(m.fromAddr);
  const platform = platformOf(domain);
  const sender: SenderIdentity = {
    address: m.fromAddr,
    domain,
    kind: platform ? "platform" : isWebmail(domain) ? "webmail" : "other",
    platform,
  };
  const auth = authVerdict(m.authResults, domain);
  const high: string[] = [];
  const notes: string[] = [];
  const override = senderOverride(senders, m.fromAddr);
  // plataforma provada pelo DMARC/DKIM: os links e o texto dela não acusam golpe sozinhos (viram observação)
  const provenPlatform = !!platform && auth.aligned;

  if (override?.override === "blocked") high.push("remetente bloqueado por você");
  if (auth.dmarc === "fail") high.push("DMARC falhou: o remetente pode ser falso");
  else if (auth.present && !auth.ok) high.push("autenticação do remetente falhou (SPF sem DKIM)");
  if (!auth.present) notes.push("sem resultado de autenticação do Gmail");
  else if (!auth.aligned) notes.push("autenticação não confirma o domínio do remetente");
  const look = lookalikeOf(domain);
  if (look) high.push(`domínio ${domain} imita ${look}`);
  const nameBrand = brandInName(m.fromName);
  if (nameBrand && platform !== nameBrand)
    high.push(`nome "${m.fromName}" cita ${nameBrand}, mas o domínio é ${domain}`);
  const replyDomain = domainOfAddress(m.replyTo);
  if (replyDomain && domain && registrableDomain(replyDomain) !== registrableDomain(domain)) {
    // plataforma de recrutamento provada responde pela empresa; Reply-To para um site em que a pessoa se candidatou também
    const expected =
      (provenPlatform && ATS_PLATFORMS.has(platform as string)) ||
      appliedDomains.has(registrableDomain(replyDomain));
    if (lookalikeOf(replyDomain) || (platform && !platformOf(replyDomain) && !expected))
      high.push(`Reply-To em outro domínio (${replyDomain})`);
    else notes.push(`Reply-To em outro domínio (${replyDomain})`);
  }
  for (const a of m.attachments)
    if (DANGEROUS_EXT.test(a.filename) || /text\/html/i.test(a.contentType))
      high.push(`anexo perigoso: ${a.filename || a.contentType}`);
  for (const link of m.links) {
    let host: string;
    try {
      host = new URL(link).hostname.toLowerCase();
    } catch {
      continue;
    }
    const linkRisk = /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
      ? `link para endereço IP (${host})`
      : host.split(".").some((l) => l.startsWith("xn--"))
        ? `link com domínio disfarçado (${host})`
        : lookalikeOf(host)
          ? `link para domínio que imita ${lookalikeOf(host)} (${host})`
          : null;
    if (linkRisk) (provenPlatform ? notes : high).push(linkRisk);
    else if (SHORTENERS.has(registrableDomain(host)) || SHORTENERS.has(host))
      notes.push(`link encurtado (${host})`);
  }
  const body = `${m.subject}\n${m.text}`;
  for (const re of SCAM) {
    const hit = body.match(re);
    if (hit) (provenPlatform ? notes : high).push(`termo de golpe de vaga: "${hit[0]}"`);
  }
  // confiar (lista ou histórico) exige a autenticação alinhada ao domínio do From (revisão do M3)
  if (override?.override === "trusted" && auth.present && !auth.aligned)
    high.push("remetente confiável, mas a autenticação não confirma o domínio");

  const history = m.fromAddr ? senders.get(m.fromAddr) : null;
  if (history && history.rejectedCount >= 2 && history.rejectedCount > history.okCount)
    high.push("e-mails deste remetente já foram recusados na revisão");

  const reasons = [...new Set([...high, ...notes])];
  if (high.length) return { level: "high", reasons, sender, auth, trustedBy: null };
  if (override?.override === "trusted" && auth.aligned)
    return { level: "trusted", reasons, sender, auth, trustedBy: "list" };
  if (provenPlatform) return { level: "trusted", reasons, sender, auth, trustedBy: "platform" };
  if (history && history.okCount >= 3 && history.rejectedCount === 0 && auth.aligned)
    return { level: "trusted", reasons, sender, auth, trustedBy: "history" };
  if (domain && auth.aligned && appliedDomains.has(registrableDomain(domain)))
    return { level: "trusted", reasons, sender, auth, trustedBy: "applied" };
  return { level: "neutral", reasons, sender, auth, trustedBy: null };
}
