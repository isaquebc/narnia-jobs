import type {
  CoverLetterContent,
  CvContent,
  CvHeader,
  CvSection,
  Paper,
} from "@narnia-jobs/shared";
import { type FontFamily, fontFaces, fontName } from "./fonts";
import { html, raw, type SafeHtml } from "./html";
import { formatPeriod, sectionLabel } from "./labels";

/**
 * Templates padrão do CV e da carta (F05 §2.6): Clássico, Moderno e Compacto. Mesma estrutura em uma coluna, texto real
 * e títulos de seção comuns (bons para ATS); muda só o estilo. Saída determinística: mesmo conteúdo + template = mesmo
 * HTML. Nada externo: fontes inline e nenhum `<img>`, `<link>` ou `<script>`.
 */
export type BuiltinTemplateId = "classico" | "moderno" | "compacto";

interface Style {
  id: BuiltinTemplateId;
  name: string;
  fonts: Array<[FontFamily, number, ("normal" | "italic")?]>;
  css: string;
}

const BASE_CSS = `*{box-sizing:border-box;margin:0;padding:0}
body{color:#1f2328;line-height:1.35;-webkit-print-color-adjust:exact;print-color-adjust:exact}
a{color:inherit;text-decoration:none}
.hd{margin-bottom:10pt}
.contact a,.contact span{white-space:nowrap}
.contact .sep{margin:0 4pt;color:#8b949e}
.sec{margin-top:9pt}
.sec h2{break-after:avoid}
.entry{margin-top:6pt;break-inside:avoid-page}
.entry-hd{display:flex;justify-content:space-between;gap:8pt;break-after:avoid}
.entry-hd .period{white-space:nowrap;flex:none}
.entry ul{margin:2pt 0 0 12pt}
.entry li{margin-top:1.5pt}
.skills p{margin-top:2pt}
.para{margin-top:9pt;text-align:justify}
.greeting{margin-top:14pt}
.signature{margin-top:16pt}`;

const STYLES: Style[] = [
  {
    id: "classico",
    name: "Clássico",
    fonts: [
      ["source-serif-4", 400],
      ["source-serif-4", 600],
      ["source-serif-4", 700],
      ["source-serif-4", 400, "italic"],
    ],
    css: `body{font-family:${fontName("source-serif-4")},serif;font-size:10.5pt}
.name{font-size:21pt;font-weight:700;letter-spacing:.2pt}
.title{font-size:11.5pt;font-style:italic;margin-top:1pt}
.contact{font-size:9.5pt;margin-top:4pt}
.sec h2{font-size:11pt;font-weight:700;text-transform:uppercase;letter-spacing:.8pt;border-bottom:.6pt solid #1f2328;padding-bottom:1.5pt;margin-bottom:3pt}
.entry h3{font-size:10.5pt;font-weight:600}
.entry .period,.entry .meta{font-size:9.5pt;color:#57606a}
.tech{font-size:9pt;color:#57606a;margin-top:2pt}`,
  },
  {
    id: "moderno",
    name: "Moderno",
    fonts: [
      ["inter", 400],
      ["inter", 600],
      ["inter", 700],
      ["ibm-plex-mono", 400],
    ],
    css: `body{font-family:${fontName("inter")},sans-serif;font-size:10pt}
.name{font-size:22pt;font-weight:700;color:#0b3d91}
.title{font-size:11pt;font-weight:600;color:#57606a;margin-top:1pt}
.contact{font-size:9pt;margin-top:5pt}
.sec h2{font-size:10.5pt;font-weight:700;color:#0b3d91;text-transform:uppercase;letter-spacing:1pt;margin-bottom:3pt}
.entry h3{font-size:10pt;font-weight:600}
.entry .period,.entry .meta{font-size:9pt;color:#57606a}
.tech{font-family:${fontName("ibm-plex-mono")},monospace;font-size:8.5pt;color:#57606a;margin-top:2pt}`,
  },
  {
    id: "compacto",
    name: "Compacto",
    fonts: [
      ["inter", 400],
      ["inter", 600],
      ["inter", 700],
    ],
    css: `body{font-family:${fontName("inter")},sans-serif;font-size:9.5pt;line-height:1.3}
.name{font-size:17pt;font-weight:700}
.title{font-size:10pt;font-weight:600;margin-top:1pt}
.contact{font-size:8.5pt;margin-top:3pt}
.sec{margin-top:7pt}
.sec h2{font-size:9.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.6pt;border-bottom:.5pt solid #8b949e;margin-bottom:2pt}
.entry{margin-top:4pt}
.entry h3{font-size:9.5pt;font-weight:600}
.entry .period,.entry .meta{font-size:8.5pt;color:#57606a}
.tech{font-size:8.5pt;color:#57606a;margin-top:1pt}`,
  },
];

export const BUILTIN_TEMPLATES = STYLES.map(({ id, name }) => ({ id, name }));

export const isBuiltinTemplate = (id: string): id is BuiltinTemplateId =>
  STYLES.some((s) => s.id === id);

const MARGINS: Record<BuiltinTemplateId, string> = {
  classico: "16mm 17mm",
  moderno: "15mm 16mm",
  compacto: "12mm 13mm",
};

function header(h: CvHeader): SafeHtml {
  const items: SafeHtml[] = [];
  if (h.location) items.push(html`<span>${h.location}</span>`);
  for (const l of h.links) {
    const label = l.kind === "whatsapp" && h.phone ? h.phone : l.label;
    items.push(html`<a href="${l.url}">${label}</a>`);
  }
  if (h.phone && !h.links.some((l) => l.kind === "whatsapp"))
    items.push(html`<span>${h.phone}</span>`);
  const contact = items.map((it, i) => (i === 0 ? it : html`<span class="sep">·</span>${it}`));
  return html`<header class="hd"><h1 class="name">${h.name}</h1><p class="title">${h.title}</p><p class="contact">${contact}</p></header>`;
}

function section(c: CvContent, s: CvSection): SafeHtml | null {
  const loc = c.meta.locale;
  const wrap = (body: SafeHtml) =>
    html`<section class="sec sec-${s}"><h2>${sectionLabel(loc, s)}</h2>${body}</section>`;
  switch (s) {
    case "summary":
      return wrap(html`<p class="summary">${c.summary}</p>`);
    case "experience":
      return c.experiences.length === 0
        ? null
        : wrap(
            html`${c.experiences.map(
              (e) =>
                html`<article class="entry"><div class="entry-hd"><h3>${e.title} · ${e.company}</h3><span class="period">${formatPeriod(loc, e.start, e.end)}</span></div>${
                  e.location ? html`<p class="meta">${e.location}</p>` : null
                }${e.bullets.length ? html`<ul>${e.bullets.map((b) => html`<li>${b.text}</li>`)}</ul>` : null}${
                  e.tech.length ? html`<p class="tech">${e.tech.join(", ")}</p>` : null
                }</article>`,
            )}`,
          );
    case "skills":
      return c.skills.length === 0
        ? null
        : wrap(
            html`<div class="skills">${c.skills.map(
              (g) =>
                html`<p><strong>${g.label}:</strong> ${g.items.map((i) => i.name).join(", ")}</p>`,
            )}</div>`,
          );
    case "projects":
      return c.projects.length === 0
        ? null
        : wrap(
            html`${c.projects.map(
              (p) =>
                html`<article class="entry"><div class="entry-hd"><h3>${p.name}</h3>${
                  p.url
                    ? html`<a class="period" href="${p.url}">${p.url.replace(/^https?:\/\//, "")}</a>`
                    : null
                }</div>${p.description ? html`<p>${p.description}</p>` : null}${
                  p.tech.length ? html`<p class="tech">${p.tech.join(", ")}</p>` : null
                }</article>`,
            )}`,
          );
    case "education":
      return c.education.length === 0
        ? null
        : wrap(
            html`${c.education.map(
              (e) =>
                html`<article class="entry"><div class="entry-hd"><h3>${[e.degree, e.course].filter(Boolean).join(", ") || e.institution}${
                  e.degree || e.course ? html` · ${e.institution}` : null
                }</h3><span class="period">${formatPeriod(loc, e.start, e.end, false)}</span></div></article>`,
            )}`,
          );
    case "languages":
      return c.languages.length === 0
        ? null
        : wrap(html`<p>${c.languages.map((l) => `${l.name} (${l.level})`).join(" · ")}</p>`);
  }
}

function page(style: Style, paper: Paper, lang: string, title: string, body: SafeHtml): string {
  const css = `@page{size:${paper};margin:${MARGINS[style.id]}}${fontFaces(style.fonts)}${BASE_CSS}${style.css}`;
  return html`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${title}</title><style>${raw(css)}</style></head><body>${body}</body></html>`
    .value;
}

export function renderDocumentHtml(
  content: CvContent | CoverLetterContent,
  templateId: BuiltinTemplateId,
): string {
  const style = STYLES.find((s) => s.id === templateId) as Style;
  const { meta } = content;
  if (content.meta.kind === "cover_letter") {
    const l = content as CoverLetterContent;
    const body = html`${header(l.header)}<p class="greeting">${l.greeting}</p>${l.paragraphs.map(
      (p) => html`<p class="para">${p.text}</p>`,
    )}<p class="signature">${l.signature}</p>`;
    return page(style, meta.paper, meta.locale, l.header.name, body);
  }
  const c = content as CvContent;
  const sections = c.sectionsOrder
    .map((s) => section(c, s))
    .filter((s): s is SafeHtml => s !== null);
  return page(
    style,
    meta.paper,
    meta.locale,
    c.header.name,
    html`${header(c.header)}<main>${sections}</main>`,
  );
}
