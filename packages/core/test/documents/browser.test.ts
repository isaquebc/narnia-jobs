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

  it("carta em PDF: 1 página sem apontamento", async () => {
    const r = await renderPdf(ws as string, renderDocumentHtml(LETTER, "classico"), {
      paper: "A4",
    });
    if (!r.ok) throw new Error(r.message);
    const insp = await inspectPdf(r.pdf);
    expect(insp.pages).toHaveLength(1);
    expect(layoutIssues(insp, { headings: [] })).toEqual([]);
  });
});
