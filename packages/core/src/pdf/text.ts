import { getDocumentProxy, extractText as unpdfExtract } from "unpdf";
import { ExtractError } from "../extract/errors";
import { type DetectedLanguage, detectLanguage } from "../extract/language";

export const MAX_PDF_PAGES = 20;

export interface PdfTextResult {
  pages: string[];
  text: string;
  pageCount: number;
  /** 0–1: densidade e legibilidade da camada de texto; ~0 em PDF escaneado. */
  quality: number;
  language: DetectedLanguage;
  tooManyPages: boolean;
}

export function textLayerQuality(pages: string[]): number {
  const total = pages.join("").length;
  if (total === 0 || pages.length === 0) return 0;
  const avgChars = total / pages.length;
  // ~800 caracteres por página já é um CV com camada de texto completa; acima disso satura em 1
  const density = Math.min(1, avgChars / 800);
  const nonSpace = pages.join("").replace(/\s/g, "");
  const alnum = nonSpace.replace(/[^\p{L}\p{N}]/gu, "").length;
  const ratio = nonSpace.length ? alnum / nonSpace.length : 0;
  return Math.round(density * (0.5 + 0.5 * ratio) * 1000) / 1000;
}

/** Leitura 1 (F01-3): camada de texto do PDF, por página, via unpdf (JS puro). */
export async function extractPdfText(buffer: Uint8Array): Promise<PdfTextResult> {
  let pages: string[];
  let pageCount: number;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await unpdfExtract(pdf, { mergePages: false });
    pageCount = result.totalPages;
    pages = (result.text as string[]).map((p) => p.replace(/\r\n?/g, "\n").trim());
  } catch (e) {
    throw new ExtractError("corrupt", `PDF ilegível: ${(e as Error).message}`);
  }
  const text = pages.join("\n\n").trim();
  return {
    pages,
    text,
    pageCount,
    quality: textLayerQuality(pages),
    language: detectLanguage(text),
    tooManyPages: pageCount > MAX_PDF_PAGES,
  };
}
