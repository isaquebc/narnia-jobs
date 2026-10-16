import type { CvReviewIssue } from "@narnia-jobs/shared";
import type { PdfInspection, PdfPageInfo, PdfTextItem } from "./inspect";
import type { LinkStatus } from "./link-check";

/**
 * Checagens por código da revisão (F05-13): o que é medível no PDF não gasta tokens nem depende da leitura do modelo.
 * Layout (páginas, fonte mínima, margem, sobreposição, linhas apertadas, título de seção sozinho no fim da página,
 * última página quase vazia) e links (os dos dados clicáveis no PDF, nada além deles, e todos funcionando).
 */
export const MAX_PAGES = 2;
export const MIN_FONT_PT = 8;
const EDGE_PT = 18; // ~6 mm: texto mais perto da borda que isso saiu da margem
const LAST_PAGE_MIN_FILL = 0.12;

const err = (
  area: CvReviewIssue["area"],
  message: string,
  where: string | null = null,
): CvReviewIssue => ({
  area,
  severity: "error",
  message,
  where,
});

const sample = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);

function box(i: PdfTextItem) {
  return { x1: i.x, x2: i.x + i.width, y1: i.y - i.size * 0.8, y2: i.y + i.size * 0.2 };
}

function pageIssues(
  p: PdfPageInfo,
  n: number,
  isLast: boolean,
  headings: Set<string>,
): CvReviewIssue[] {
  const where = `página ${n}`;
  const out: CvReviewIssue[] = [];
  const small = p.items.filter((i) => i.size < MIN_FONT_PT - 0.05);
  if (small.length)
    out.push(
      err(
        "layout",
        `Fonte de ${Math.round((small[0] as PdfTextItem).size * 10) / 10} pt em "${sample((small[0] as PdfTextItem).str)}" (mínimo ${MIN_FONT_PT} pt).`,
        where,
      ),
    );
  const outside = p.items.filter(
    (i) => i.x < EDGE_PT || i.x + i.width > p.width - EDGE_PT || i.y > p.height - EDGE_PT / 2,
  );
  if (outside.length)
    out.push(
      err("layout", `Texto saindo da margem: "${sample((outside[0] as PdfTextItem).str)}".`, where),
    );
  const overlap = findOverlap(p.items);
  if (overlap)
    out.push(
      err(
        "layout",
        `Texto sobreposto: "${sample(overlap[0].str)}" e "${sample(overlap[1].str)}".`,
        where,
      ),
    );
  const cramped = findCramped(p.items);
  if (cramped)
    out.push(
      err(
        "layout",
        `Linhas apertadas (espaçamento menor que a fonte) perto de "${sample(cramped.str)}".`,
        where,
      ),
    );
  const sorted = [...p.items].sort((a, b) => a.y - b.y);
  const last = sorted[sorted.length - 1];
  if (!isLast && last && headings.has(last.str.trim().toLocaleLowerCase()))
    out.push(
      err("layout", `Título de seção "${last.str.trim()}" sozinho no fim da página.`, where),
    );
  if (isLast && n > 1 && (!last || last.y < p.height * LAST_PAGE_MIN_FILL))
    out.push({ area: "layout", severity: "warning", message: "Última página quase vazia.", where });
  return out;
}

function findOverlap(items: PdfTextItem[]): [PdfTextItem, PdfTextItem] | null {
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i] as PdfTextItem;
      const b = items[j] as PdfTextItem;
      if (Math.abs(a.y - b.y) <= 1) continue; // mesma linha: trechos vizinhos
      const p = box(a);
      const q = box(b);
      const w = Math.min(p.x2, q.x2) - Math.max(p.x1, q.x1);
      const h = Math.min(p.y2, q.y2) - Math.max(p.y1, q.y1);
      if (w > 2 && h > Math.min(a.size, b.size) * 0.25) return [a, b];
    }
  return null;
}

/** Linhas consecutivas que se cruzam na horizontal com distância entre bases menor que 0,95 × a fonte da linha de baixo. */
function findCramped(items: PdfTextItem[]): PdfTextItem | null {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1] as PdfTextItem;
    const b = sorted[i] as PdfTextItem;
    const gap = b.y - a.y;
    if (gap <= 1) continue;
    const sameColumn = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0;
    if (sameColumn && gap < b.size * 0.95 && !findOverlap([a, b])) return b;
  }
  return null;
}

export function layoutIssues(insp: PdfInspection, opts: { headings: string[] }): CvReviewIssue[] {
  const out: CvReviewIssue[] = [];
  if (insp.pages.length > MAX_PAGES)
    out.push(err("pages", `O documento tem ${insp.pages.length} páginas (máximo ${MAX_PAGES}).`));
  const headings = new Set(opts.headings.map((h) => h.toLocaleLowerCase()));
  insp.pages.forEach((p, i) => {
    out.push(...pageIssues(p, i + 1, i === insp.pages.length - 1, headings));
  });
  return out;
}

const norm = (u: string) => u.replace(/\/+$/, "");

export function linkIssues(
  insp: PdfInspection,
  expected: string[],
  status: Map<string, LinkStatus>,
): CvReviewIssue[] {
  const inPdf = new Set(insp.pages.flatMap((p) => p.links).map(norm));
  const wanted = new Set(expected.map(norm));
  const out: CvReviewIssue[] = [];
  for (const u of expected)
    if (!inPdf.has(norm(u))) out.push(err("links", `O link ${u} não está clicável no PDF.`));
  for (const u of inPdf)
    if (!wanted.has(u)) out.push(err("links", `O link ${u} do PDF não está nos seus dados.`));
  for (const [u, s] of status) if (!s.ok) out.push(err("links", s.reason, u));
  return out;
}
