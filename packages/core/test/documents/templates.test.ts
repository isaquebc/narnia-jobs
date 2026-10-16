import { describe, expect, it } from "vitest";
import { escapeHtml, html, raw } from "../../src/documents/html";
import { BUILTIN_TEMPLATES, renderDocumentHtml } from "../../src/documents/templates";
import { CV_SHORT, LETTER } from "./fixtures/cv";

/** F05/M1 · HTML dos templates padrão: determinístico, sem rede, texto real e rótulos no idioma do CV. */
describe("F05/M1 core · html", () => {
  it("escapa tudo que não é marcado como confiável; listas viram texto", () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
    expect(
      html`<p>${"<b>"}</p>${raw("<i>ok</i>")}${["<1>", "<2>"].map((s) => html`<li>${s}</li>`)}`
        .value,
    ).toBe("<p>&lt;b&gt;</p><i>ok</i><li>&lt;1&gt;</li><li>&lt;2&gt;</li>");
  });
});

describe("F05/M1 core · templates padrão", () => {
  it("existem Clássico, Moderno e Compacto", () => {
    expect(BUILTIN_TEMPLATES.map((t) => t.id)).toEqual(["classico", "moderno", "compacto"]);
  });

  for (const t of ["classico", "moderno", "compacto"] as const)
    it(`${t}: nome, seções na ordem pedida, links clicáveis, sem recurso externo`, () => {
      const out = renderDocumentHtml(CV_SHORT, t);
      expect(out).toContain("Ana Souza");
      expect(out).toContain('href="https://www.linkedin.com/in/ana-souza"');
      expect(out).toContain('href="mailto:ana@example.com"');
      expect(out).toContain("&lt;com&gt;");
      const order = ["Resumo", "Experiência", "Habilidades", "Formação", "Idiomas"].map((s) =>
        out.indexOf(`>${s}<`),
      );
      expect(order.every((i) => i > 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(out).not.toContain("Startup X");
      expect(out).toMatch(/@font-face\{[^}]*src:url\(data:font\/woff2;base64,/);
      expect(out).not.toMatch(/<(script|link|img|iframe)\b/i);
      expect(out).not.toMatch(/(src|url)\(\s*["']?https?:/i);
      expect(out).toContain("size:A4");
      expect(out).toContain("mar 2021 – atual");
      expect(renderDocumentHtml(CV_SHORT, t)).toBe(out);
    });

  it("nível nativo do idioma no idioma do documento", () => {
    const withNative = {
      ...CV_SHORT,
      languages: [{ factId: "l0", name: "Português", level: "native" }],
    };
    expect(renderDocumentHtml(withNative, "classico")).toContain("Português (nativo)");
    const en = { ...withNative, meta: { ...withNative.meta, locale: "en-US" as const } };
    expect(renderDocumentHtml(en, "classico")).toContain("Português (Native)");
  });

  it("en-US em Letter: rótulos e datas em inglês", () => {
    const en = {
      ...CV_SHORT,
      meta: { ...CV_SHORT.meta, locale: "en-US" as const, paper: "Letter" as const },
    };
    const out = renderDocumentHtml(en, "classico");
    expect(out).toContain(">Experience<");
    expect(out).toContain(">Skills<");
    expect(out).toContain("Mar 2021 – Present");
    expect(out).toContain("size:Letter");
    expect(out).toContain('lang="en-US"');
  });

  it("carta: cabeçalho, saudação, parágrafos e assinatura", () => {
    const out = renderDocumentHtml(LETTER, "classico");
    expect(out).toContain("Olá, time da Acme");
    expect(out.match(/<p class="para">/g)).toHaveLength(4);
    expect(out).toContain("Ana Souza");
    expect(out).toContain('href="https://wa.me/5519999990000"');
  });
});
