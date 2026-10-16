import {
  type CvContent,
  CvLocaleSchema,
  DocumentKindSchema,
  type Paper,
  PaperSchema,
} from "@narnia-jobs/shared";
import { unzipSync } from "fflate";
import Handlebars from "handlebars";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import { formatPartialDate, formatPeriod, languageLevelLabel, sectionLabel } from "./labels";

/**
 * Template do usuário (F05 §2.6, F05-1, F05-4): `.zip` com `template.html` (Handlebars), `style.css`, `manifest.json` e
 * assets (png, jpg, svg, woff2). Validação: até 5 MB (15 MB descompactado, 60 arquivos), só caminhos relativos sem `..`,
 * só extensões permitidas, sem `<script>`, atributos `on…`, `javascript:`, `<iframe>`/`<object>`/`<embed>`/`<link>`/
 * `<base>`/`<meta>`/`<form>`, `@import` ou `url()` externo; helpers só `t`, `date`, `period`, `join`, `level`. Na montagem, os
 * dados entram escapados, as imagens e fontes viram `data:` e o HTML final passa pelo `sanitize-html`; o navegador
 * monta com JavaScript desligado e a rede toda bloqueada.
 */
export const TEMPLATE_ZIP_MAX_BYTES = 5 * 1024 * 1024;
const UNZIPPED_MAX_BYTES = 15 * 1024 * 1024;
const MAX_FILES = 60;
const ASSET_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  woff2: "font/woff2",
};
const TEXT_FILES = new Set(["template.html", "style.css", "manifest.json"]);

export const TemplateManifestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  version: z.string().max(20).optional(),
  locales: z.array(CvLocaleSchema).min(1).default(["pt-BR", "en-US"]),
  paper: z.array(PaperSchema).min(1).optional(),
  kinds: z.array(DocumentKindSchema).min(1).default(["cv"]),
});
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;

export interface UserTemplate {
  manifest: TemplateManifest;
  html: string;
  css: string;
  assets: Map<string, Uint8Array>;
}

const FORBIDDEN_HTML: Array<[RegExp, string]> = [
  [/<script\b/i, "<script> não é permitido."],
  [/\son[a-z]+\s*=/i, "Atributos de evento (on…) não são permitidos."],
  [/javascript:/i, "Links javascript: não são permitidos."],
  ...["iframe", "object", "embed", "link", "base", "meta", "form"].map((tag): [RegExp, string] => [
    new RegExp(`<${tag}\\b`, "i"),
    `<${tag}> não é permitido.`,
  ]),
];
const FORBIDDEN_CSS: Array<[RegExp, string]> = [
  [/@import/i, "@import não é permitido no CSS."],
  [
    /url\(\s*['"]?\s*(https?:|\/\/|ftp:|file:)/i,
    "url() externo não é permitido no CSS: use arquivos do próprio .zip.",
  ],
  [/expression\s*\(/i, "expression() não é permitido no CSS."],
  [/javascript:/i, "javascript: não é permitido no CSS."],
];

const HELPERS = ["t", "date", "period", "join", "level"] as const;
const decoder = new TextDecoder();

function safePath(p: string): boolean {
  return (
    !p.startsWith("/") && !p.includes("\\") && !p.split("/").some((s) => s === ".." || s === ".")
  );
}

export function readTemplateZip(
  buf: Uint8Array,
): { ok: true; template: UserTemplate } | { ok: false; errors: string[] } {
  if (buf.byteLength > TEMPLATE_ZIP_MAX_BYTES)
    return { ok: false, errors: ["O arquivo passa de 5 MB."] };
  let files: Record<string, Uint8Array>;
  let total = 0;
  let count = 0;
  try {
    files = unzipSync(buf, {
      filter: (f) => {
        total += f.originalSize;
        count++;
        if (total > UNZIPPED_MAX_BYTES || count > MAX_FILES) throw new Error("grande demais");
        return true;
      },
    });
  } catch (e) {
    return {
      ok: false,
      errors: [
        (e as Error).message === "grande demais"
          ? "O .zip descompactado passa de 15 MB ou de 60 arquivos."
          : "O arquivo não é um .zip válido.",
      ],
    };
  }
  const errors: string[] = [];
  const assets = new Map<string, Uint8Array>();
  const text: Record<string, string> = {};
  for (const [path, data] of Object.entries(files)) {
    if (path.endsWith("/")) continue;
    if (!safePath(path)) {
      errors.push(`Arquivo com caminho inválido: ${path}.`);
      continue;
    }
    if (TEXT_FILES.has(path)) {
      text[path] = decoder.decode(data);
      continue;
    }
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    if (!ASSET_TYPES[ext]) {
      errors.push(
        `Tipo de arquivo não permitido: ${path} (.${ext}). Só html, css, json, png, jpg, svg e woff2.`,
      );
      continue;
    }
    assets.set(path, data);
  }
  for (const f of TEXT_FILES) if (text[f] === undefined) errors.push(`Falta o ${f} no .zip.`);
  let manifest: TemplateManifest | null = null;
  if (text["manifest.json"] !== undefined) {
    try {
      const parsed = TemplateManifestSchema.safeParse(JSON.parse(text["manifest.json"]));
      if (parsed.success) manifest = parsed.data;
      else
        errors.push(
          `manifest.json inválido: ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? ""}`.trim(),
        );
    } catch {
      errors.push("manifest.json não é um JSON válido.");
    }
  }
  const html = text["template.html"] ?? "";
  const css = text["style.css"] ?? "";
  for (const [re, msg] of FORBIDDEN_HTML) if (re.test(html)) errors.push(msg);
  for (const [re, msg] of FORBIDDEN_CSS) if (re.test(css)) errors.push(msg);
  for (const svg of [...assets.entries()].filter(([p]) => p.endsWith(".svg")))
    if (/<script\b|\son[a-z]+\s*=|javascript:/i.test(decoder.decode(svg[1])))
      errors.push(`SVG com script não é permitido: ${svg[0]}.`);
  if (html) {
    try {
      Handlebars.precompile(html, {
        knownHelpersOnly: true,
        knownHelpers: Object.fromEntries(HELPERS.map((h) => [h, true])),
      });
    } catch (e) {
      errors.push(
        `template.html não compila (só os helpers ${HELPERS.join(", ")}): ${(e as Error).message.split("\n")[0]}`,
      );
    }
  }
  if (errors.length || !manifest) return { ok: false, errors };
  return { ok: true, template: { manifest, html, css, assets } };
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

function dataUri(t: UserTemplate, ref: string): string | null {
  const path = ref.replace(/^\.\//, "").split(/[?#]/)[0] as string;
  const asset = t.assets.get(path);
  if (!asset) return null;
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return `data:${ASSET_TYPES[ext]};base64,${b64(asset)}`;
}

export function renderUserTemplate(t: UserTemplate, content: CvContent, paper: Paper): string {
  const hb = Handlebars.create();
  const locale = content.meta.locale;
  hb.registerHelper("t", (key: string) =>
    ["summary", "experience", "skills", "projects", "education", "languages"].includes(key)
      ? sectionLabel(locale, key as Parameters<typeof sectionLabel>[1])
      : key,
  );
  hb.registerHelper("date", (d: unknown) =>
    typeof d === "string" && d ? formatPartialDate(locale, d) : "",
  );
  hb.registerHelper("period", (start: unknown, end: unknown) =>
    formatPeriod(
      locale,
      typeof start === "string" ? start : null,
      typeof end === "string" ? end : null,
    ),
  );
  hb.registerHelper("join", (list: unknown, sep: unknown) =>
    Array.isArray(list) ? list.map(String).join(typeof sep === "string" ? sep : ", ") : "",
  );
  hb.registerHelper("level", (l: unknown) =>
    typeof l === "string" ? languageLevelLabel(locale, l) : "",
  );
  const template = hb.compile(t.html, {
    knownHelpersOnly: true,
    knownHelpers: Object.fromEntries(HELPERS.map((h) => [h, true])),
  });
  const raw = template(content);
  // imagens do .zip viram data: antes do sanitize (que só aceita data: em <img>)
  const withImgs = raw.replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/gi, (m, a, src, z) => {
    const uri = dataUri(t, src);
    return uri ? `${a}${uri}${z}` : m;
  });
  const body = sanitizeHtml(withImgs, {
    allowedTags: [
      "div",
      "span",
      "p",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "a",
      "strong",
      "em",
      "b",
      "i",
      "u",
      "br",
      "hr",
      "section",
      "header",
      "footer",
      "main",
      "article",
      "aside",
      "table",
      "thead",
      "tbody",
      "tr",
      "td",
      "th",
      "img",
      "small",
      "sup",
      "sub",
      "time",
      "address",
    ],
    allowedAttributes: {
      "*": ["class", "id"],
      a: ["href"],
      img: ["src", "alt", "width", "height"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["data"] },
    allowProtocolRelative: false,
  });
  const css = t.css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, _q, ref: string) => {
    if (ref.startsWith("data:")) return m;
    const uri = dataUri(t, ref.trim());
    return uri ? `url(${uri})` : "url()";
  });
  const style = `@page{size:${paper}}${css.replace(/<\/style/gi, "")}`;
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>${style}</style></head><body>${body}</body></html>`;
}

/** CV fictício para validar e mostrar a prévia de um template enviado (Ana Maria Exemplo, empresas inventadas). */
export const SAMPLE_CV: CvContent = {
  meta: {
    kind: "cv",
    locale: "pt-BR",
    paper: "A4",
    profileId: "exemplo",
    postingId: null,
    generatedAt: "2026-10-16T12:00:00Z",
  },
  header: {
    name: "Ana Maria Exemplo",
    title: "Engenheira de Software Sênior",
    location: "Campinas, SP",
    email: "ana.exemplo@example.com",
    phone: "(19) 99999-0000",
    links: [
      { kind: "email", url: "mailto:ana.exemplo@example.com", label: "ana.exemplo@example.com" },
      {
        kind: "linkedin",
        url: "https://www.linkedin.com/in/ana-exemplo",
        label: "linkedin.com/in/ana-exemplo",
      },
    ],
  },
  summary:
    "Engenheira de software com 9 anos em plataformas de pagamento, com foco em performance e confiabilidade.",
  experiences: [
    {
      factId: "e1",
      company: "Acme Pagamentos",
      title: "Engenheira de Software Sênior",
      start: "2021-03",
      end: null,
      location: "Remoto",
      bullets: [
        {
          text: "Reduziu a latência p95 do checkout de 800 ms para 300 ms.",
          factIds: [{ kind: "achievement", id: "a1" }],
        },
        {
          text: "Liderou a migração de 40 serviços para containers, sem downtime.",
          factIds: [{ kind: "achievement", id: "a2" }],
        },
      ],
      tech: ["Node.js", "PostgreSQL", "Docker"],
      matchScore: 90,
    },
    {
      factId: "e2",
      company: "Globex Logística",
      title: "Desenvolvedora Backend",
      start: "2017-01",
      end: "2021-02",
      location: "São Paulo, SP",
      bullets: [
        {
          text: "Criou o serviço de rastreio em tempo real (120 mil eventos/min).",
          factIds: [{ kind: "achievement", id: "a3" }],
        },
      ],
      tech: ["Java", "Redis"],
      matchScore: 70,
    },
  ],
  skills: [
    {
      label: "Backend",
      items: [{ name: "Node.js", factIds: [{ kind: "skill", id: "s1" }], matchScore: 95 }],
    },
  ],
  projects: [],
  education: [
    {
      factId: "ed1",
      institution: "Unicamp",
      course: "Ciência da Computação",
      degree: "Bacharelado",
      start: "2012",
      end: "2016",
    },
  ],
  languages: [{ factId: "l1", name: "Inglês", level: "C1" }],
  adjacent: [],
  sectionsOrder: ["summary", "experience", "skills", "education", "languages"],
  omitted: [],
  provenance: { factIdsUsed: [], unverifiedFactIds: [] },
};
