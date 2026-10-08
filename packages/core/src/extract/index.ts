import { extractPdfText } from "../pdf/text";
import { type DetectedType, detectFileType, type FileKind, MAX_UPLOAD_BYTES } from "./detect";
import { extractDocxText } from "./docx";
import { ExtractError } from "./errors";
import { normalizeFreeText } from "./free-text";
import { type DetectedLanguage, detectLanguage } from "./language";
import { extractMarkdownText } from "./markdown";

export * from "./detect";
export * from "./docx";
export * from "./errors";
export * from "./free-text";
export * from "./language";
export * from "./markdown";

export interface ExtractedText {
  kind: Exclude<FileKind, "unknown">;
  mime: string;
  text: string;
  /** Só PDF. */
  pages?: number;
  /** 0–1: confiança de que o texto representa o documento (PDF: densidade da camada de texto). */
  quality: number;
  language: DetectedLanguage;
  tooManyPages?: boolean;
}

/** Leitura determinística de um arquivo enviado (sem tokens). PDF usa só a camada de texto aqui; OCR e leitura pelo modelo são jobs. */
export async function extractText(
  buffer: Uint8Array,
  opts: { originalName?: string } = {},
): Promise<ExtractedText> {
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new ExtractError("too_large", `Arquivo acima de ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`);
  }
  const detected: DetectedType = detectFileType(buffer, opts.originalName);
  switch (detected.kind) {
    case "pdf": {
      const r = await extractPdfText(buffer);
      return {
        kind: "pdf",
        mime: detected.mime,
        text: r.text,
        pages: r.pageCount,
        quality: r.quality,
        language: r.language,
        tooManyPages: r.tooManyPages,
      };
    }
    case "docx": {
      const r = await extractDocxText(buffer);
      return {
        kind: "docx",
        mime: detected.mime,
        text: r.text,
        quality: r.text.length > 0 ? 1 : 0,
        language: detectLanguage(r.text),
      };
    }
    case "markdown": {
      const r = extractMarkdownText(Buffer.from(buffer).toString("utf8"));
      return {
        kind: "markdown",
        mime: detected.mime,
        text: r.text,
        quality: 1,
        language: detectLanguage(r.text),
      };
    }
    case "text": {
      const text = normalizeFreeText(Buffer.from(buffer).toString("utf8"));
      return {
        kind: "text",
        mime: detected.mime,
        text,
        quality: 1,
        language: detectLanguage(text),
      };
    }
    default:
      throw new ExtractError(
        "unsupported",
        "Tipo de arquivo não suportado (aceitos: PDF, DOCX, Markdown, texto)",
      );
  }
}
