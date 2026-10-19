import { describe, expect, it } from "vitest";
import { pdfRequestDecision, renderPdf } from "../../src/documents/browser";
import { layoutIssues } from "../../src/documents/checks";
import { inspectPdf } from "../../src/documents/inspect";
import { sectionLabel } from "../../src/documents/labels";
import { renderDocumentHtml } from "../../src/documents/templates";
import { CV_SHORT, cvLong, LETTER } from "./fixtures/cv";

/** F05/M1 · PDF pelo serviço `browser`: só `data:` carrega; nada de rede. */
describe("F05/M1 core · regra de rede do PDF", () => {
  it("só data: passa; http, file, blob e about são abortados", () => {
    expect(pdfRequestDecision("data:font/woff2;base64,AAAA")).toBe("continue");
    for (const u of [
      "https://exemplo.com/x.png",
      "http://10.0.0.1/",
      "file:///etc/passwd",
      "blob:abc",
      "ftp://x",
    ])
      expect(pdfRequestDecision(u), u).toBe("abort");
  });
});

// Chromium real: só onde o navegador está alcançável (worker da instância `claude`, NARNIA_BROWSER_WS definido)
const ws = process.env.NARNIA_BROWSER_WS;
describe.skipIf(!ws)("F05/M1 core · PDF com Chromium real", () => {
  it("gera um PDF de uma página para o CV curto, em A4", async () => {
    const r = await renderPdf(ws as string, renderDocumentHtml(CV_SHORT, "classico"), {
      paper: "A4",
    });
    if (!r.ok) throw new Error(r.message);
    expect(r.pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("recurso externo não carrega (a página renderiza sem ele)", async () => {
    const page = `<!doctype html><html><head><style>body{background:url(https://exemplo.com/x.png)}</style></head><body><img src="http://10.0.0.1/x.png"><p>oi</p></body></html>`;
    const r = await renderPdf(ws as string, page, { paper: "A4", javaScript: false });
    expect(r.ok).toBe(true);
    expect(r.ok && r.blocked.length).toBeGreaterThan(0);
  });

  const headings = CV_SHORT.sectionsOrder.map((s) => sectionLabel("pt-BR", s));

  for (const t of ["classico", "moderno", "compacto"] as const)
    it(`${t}: CV curto em 1 página, sem apontamento de layout, links clicáveis e texto real`, async () => {
      const r = await renderPdf(ws as string, renderDocumentHtml(CV_SHORT, t), { paper: "A4" });
      if (!r.ok) throw new Error(r.message);
      const insp = await inspectPdf(r.pdf);
      expect(insp.pages).toHaveLength(1);
      expect(layoutIssues(insp, { headings })).toEqual([]);
      expect(insp.pages[0]?.links.sort()).toEqual(CV_SHORT.header.links.map((l) => l.url).sort());
      expect(insp.text).toContain("Reduziu a latência p95 do checkout");
      expect(insp.text.toLocaleLowerCase()).toContain("experiência");
      expect(Math.round(insp.pages[0]?.width ?? 0)).toBe(595);
    });

  it("CV longo passa de 2 páginas e a checagem reprova; Letter tem 612 pt de largura", async () => {
    const long = cvLong();
    const r = await renderPdf(
      ws as string,
      renderDocumentHtml({ ...long, meta: { ...long.meta, paper: "Letter" } }, "classico"),
      {
        paper: "Letter",
      },
    );
    if (!r.ok) throw new Error(r.message);
    const insp = await inspectPdf(r.pdf);
    expect(insp.pages.length).toBeGreaterThan(2);
    expect(layoutIssues(insp, { headings })).toContainEqual(
      expect.objectContaining({ area: "pages" }),
    );
    expect(Math.round(insp.pages[0]?.width ?? 0)).toBe(612);
  });

  it("cabeçalho sobreposto (o caso que o Haiku não viu no gate) é pego pela checagem de posição do texto", async () => {
    const broken = renderDocumentHtml(CV_SHORT, "classico").replace(
      "</head>",
      "<style>.title{margin-top:-20pt}.contact{margin-top:-16pt}</style></head>",
    );
    const r = await renderPdf(ws as string, broken, { paper: "A4" });
    if (!r.ok) throw new Error(r.message);
    const issues = layoutIssues(await inspectPdf(r.pdf), { headings });
    expect(issues).toContainEqual(
      expect.objectContaining({ area: "layout", message: expect.stringMatching(/sobreposto/) }),
    );
  });

  it("carta em PDF: 1 página sem apontamento", async () => {
    const r = await renderPdf(ws as string, renderDocumentHtml(LETTER, "classico"), {
      paper: "A4",
    });
    if (!r.ok) throw new Error(r.message);
    const insp = await inspectPdf(r.pdf);
    expect(insp.pages).toHaveLength(1);
    expect(layoutIssues(insp, { headings: [] })).toEqual([]);
  });

  // dono, 2026-10-19: "Fonte de 7.7 pt" no contato e 7.3 pt nas tecnologias, em toda tentativa. Um trecho mais largo
  // que a folha fazia o Chromium encolher a página inteira (~0,86); o modelo não pode deixar nada estourar a largura
  const wide =
    "github.com/exemplo/plataforma-de-reservas-online-com-integracoes-de-cobranca-e-notificacoes-em-tempo-real";
  const overflowing: Array<[string, (c: typeof CV_SHORT) => typeof CV_SHORT]> = [
    [
      "palavra longa num bullet",
      (c) => ({
        ...c,
        experiences: c.experiences.map((e, i) =>
          i === 0
            ? { ...e, bullets: [{ text: `Publicou ${wide}`, factIds: [] }, ...e.bullets] }
            : e,
        ),
      }),
    ],
    [
      "link longo no contato",
      (c) => ({
        ...c,
        header: {
          ...c.header,
          links: [...c.header.links, { kind: "portfolio", label: wide, url: `https://${wide}` }],
        },
      }),
    ],
    [
      "muitos links curtos no contato (a linha inteira não pode virar um bloco só)",
      (c) => ({
        ...c,
        header: {
          ...c.header,
          location: "São Paulo, SP",
          phone: "+55 11 98888-7777",
          links: [
            ...c.header.links,
            ...["github", "portfolio", "blog", "medium", "stackoverflow", "dribbble"].map((k) => ({
              kind: "portfolio" as const,
              label: `${k}.com/exemplo`,
              url: `https://${k}.com/exemplo`,
            })),
          ],
        },
      }),
    ],
    [
      "tecnologia longa",
      (c) => ({
        ...c,
        experiences: c.experiences.map((e, i) =>
          i === 0 ? { ...e, tech: [...e.tech, wide.replace(/[/.]/g, "-")] } : e,
        ),
      }),
    ],
  ];
  for (const t of ["classico", "moderno", "compacto"] as const)
    for (const [what, make] of overflowing)
      it(`${t}: ${what} quebra a linha em vez de encolher a página (fonte ≥ 8 pt)`, async () => {
        const r = await renderPdf(ws as string, renderDocumentHtml(make(CV_SHORT), t), {
          paper: "A4",
        });
        if (!r.ok) throw new Error(r.message);
        const insp = await inspectPdf(r.pdf);
        const sizes = insp.pages.flatMap((p) => p.items.map((i) => i.size));
        expect(Math.min(...sizes)).toBeGreaterThanOrEqual(8);
        expect(layoutIssues(insp, { headings }).filter((i) => i.message.includes("Fonte"))).toEqual(
          [],
        );
      });
});
