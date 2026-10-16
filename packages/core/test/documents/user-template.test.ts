import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readTemplateZip, renderUserTemplate, SAMPLE_CV } from "../../src/documents/user-template";

/** F05/M7 · template do usuário (.zip com Handlebars): validação, sandbox e montagem com os assets embutidos. */
const HTML = `<header><h1>{{header.name}}</h1><p class="t">{{header.title}}</p>
<p>{{#each header.links}}<a href="{{url}}">{{label}}</a> {{/each}}</p></header>
<section><h2>{{t "experience"}}</h2>{{#each experiences}}<article><h3>{{title}} · {{company}}</h3>
<span>{{period start end}}</span><ul>{{#each bullets}}<li>{{text}}</li>{{/each}}</ul>
<p>{{join tech ", "}}</p></article>{{/each}}</section><img src="./logo.png" alt="logo">`;
const CSS = `body{font-family:"Minha Fonte";background:url(./fundo.png)}@font-face{font-family:"Minha Fonte";src:url(fonts/minha.woff2)}`;
const MANIFEST = JSON.stringify({
  name: "Meu modelo",
  version: "1.0",
  locales: ["pt-BR", "en-US"],
});
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function zip(files: Record<string, string | Uint8Array>) {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v]),
    ),
  );
}
const valid = () =>
  zip({
    "template.html": HTML,
    "style.css": CSS,
    "manifest.json": MANIFEST,
    "logo.png": PNG,
    "fundo.png": PNG,
    "fonts/minha.woff2": PNG,
  });

describe("F05/M7 core · leitura e validação do .zip", () => {
  it("zip válido: manifesto, HTML, CSS e assets", () => {
    const r = readTemplateZip(valid());
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect(r.template.manifest).toMatchObject({ name: "Meu modelo", locales: ["pt-BR", "en-US"] });
    expect([...r.template.assets.keys()].sort()).toEqual([
      "fonts/minha.woff2",
      "fundo.png",
      "logo.png",
    ]);
  });

  it("recusa script, on*, javascript:, iframe, @import, url externo e helper desconhecido, com o motivo", () => {
    const bad = (html: string, css = CSS) =>
      readTemplateZip(zip({ "template.html": html, "style.css": css, "manifest.json": MANIFEST }));
    const msgs = (r: ReturnType<typeof readTemplateZip>) => (r.ok ? "" : r.errors.join("\n"));
    expect(msgs(bad(`${HTML}<script>alert(1)</script>`))).toMatch(/<script>/);
    expect(msgs(bad(`<p onclick="x()">oi</p>`))).toMatch(/on…/);
    expect(msgs(bad(`<a href="javascript:alert(1)">x</a>`))).toMatch(/javascript:/);
    expect(msgs(bad(`<iframe src="x"></iframe>`))).toMatch(/<iframe>/);
    expect(msgs(bad(HTML, `@import url(x.css);`))).toMatch(/@import/);
    expect(msgs(bad(HTML, `body{background:url(https://exemplo.com/x.png)}`))).toMatch(
      /url\(\) externo/,
    );
    expect(msgs(bad(`{{exec "rm"}}`))).toMatch(/não compila|helper/i);
  });

  it("recusa caminho com .., .js dentro, falta de arquivo obrigatório e zip grande demais", () => {
    const msgs = (r: ReturnType<typeof readTemplateZip>) => (r.ok ? "" : r.errors.join("\n"));
    expect(
      msgs(
        readTemplateZip(
          zip({
            "template.html": HTML,
            "style.css": CSS,
            "manifest.json": MANIFEST,
            "../fora.png": PNG,
          }),
        ),
      ),
    ).toMatch(/caminho/);
    expect(
      msgs(
        readTemplateZip(
          zip({ "template.html": HTML, "style.css": CSS, "manifest.json": MANIFEST, "x.js": "1" }),
        ),
      ),
    ).toMatch(/\.js/);
    expect(
      msgs(readTemplateZip(zip({ "template.html": HTML, "manifest.json": MANIFEST }))),
    ).toMatch(/style\.css/);
    expect(
      msgs(
        readTemplateZip(zip({ "template.html": HTML, "style.css": CSS, "manifest.json": "{}" })),
      ),
    ).toMatch(/manifest/);
    expect(msgs(readTemplateZip(new Uint8Array(6 * 1024 * 1024)))).toMatch(/5 MB/);
    expect(msgs(readTemplateZip(new Uint8Array([1, 2, 3])))).toMatch(/zip/);
  });
});

describe("F05/M7 core · montagem com o modelo do usuário", () => {
  it("dados do CV, helpers, assets embutidos como data: e nada externo", () => {
    const r = readTemplateZip(valid());
    if (!r.ok) throw new Error(r.errors.join("; "));
    const html = renderUserTemplate(r.template, SAMPLE_CV, "A4");
    expect(html).toContain(SAMPLE_CV.header.name);
    expect(html).toContain(">Experiência<");
    expect(html).toMatch(/<img src="data:image\/png;base64,[^"]+" alt="logo"/);
    expect(html).toMatch(/url\(data:image\/png;base64,/);
    expect(html).toMatch(/url\(data:font\/woff2;base64,/);
    expect(html).toContain("size:A4");
    expect(html).toContain("mar 2021 – atual");
    expect(html).not.toMatch(/(src|href)="(\.\/|fonts\/)/);
  });

  it("dado do CV com HTML é escapado; o sanitize tira o que sobrar", () => {
    const r = readTemplateZip(
      zip({
        "template.html": `<p>{{summary}}</p><p>{{{summary}}}</p>`,
        "style.css": "",
        "manifest.json": MANIFEST,
      }),
    );
    if (!r.ok) throw new Error(r.errors.join("; "));
    const html = renderUserTemplate(
      r.template,
      { ...SAMPLE_CV, summary: `<img src=x onerror=alert(1)><script>1</script>` },
      "A4",
    );
    expect(html).not.toMatch(/<script|<img[^>]*onerror/);
    expect(html).toContain("&lt;script&gt;");
  });
});
