import { getDocumentProxy } from "unpdf";

/**
 * Leitura do PDF gerado para as checagens por código (F05-13): texto por página com posição e tamanho de fonte de
 * cada trecho (para fonte mínima, margem, sobreposição, espaçamento e quebras) e os links clicáveis (anotações).
 * Coordenadas em pontos, com o topo da página como zero.
 */
export interface PdfTextItem {
  str: string;
  x: number;
  /** Linha de base, medida do topo da página. */
  y: number;
  width: number;
  size: number;
}

export interface PdfPageInfo {
  width: number;
  height: number;
  items: PdfTextItem[];
  links: string[];
}

export interface PdfInspection {
  pages: PdfPageInfo[];
  text: string;
}

export async function inspectPdf(buffer: Uint8Array): Promise<PdfInspection> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const pages: PdfPageInfo[] = [];
  const texts: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const [, , width = 0, height = 0] = page.view as number[];
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    let line = "";
    let lastY: number | null = null;
    const lines: string[] = [];
    for (const it of content.items as Array<{
      str?: string;
      transform?: number[];
      width?: number;
    }>) {
      if (typeof it.str !== "string" || !it.transform) continue;
      const [a = 0, b = 0, , , e = 0, f = 0] = it.transform;
      const y = height - f;
      if (it.str.trim())
        items.push({ str: it.str, x: e, y, width: it.width ?? 0, size: Math.hypot(a, b) });
      if (lastY !== null && Math.abs(y - lastY) > 1) {
        lines.push(line);
        line = "";
      }
      line += it.str;
      lastY = y;
    }
    lines.push(line);
    texts.push(
      lines
        .map((l) => l.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n"),
    );
    const annotations = (await page.getAnnotations()) as Array<{
      subtype?: string;
      url?: string;
      unsafeUrl?: string;
    }>;
    const links = annotations
      .filter((a) => a.subtype === "Link")
      .map((a) => a.url ?? a.unsafeUrl)
      .filter((u): u is string => typeof u === "string");
    pages.push({ width, height, items, links });
  }
  return { pages, text: texts.join("\n\n") };
}
