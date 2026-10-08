export type FileKind = "pdf" | "docx" | "markdown" | "text" | "unknown";

export interface DetectedType {
  kind: FileKind;
  mime: string;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const MIME: Record<FileKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  markdown: "text/markdown",
  text: "text/plain",
  unknown: "application/octet-stream",
};

function looksLikeMarkdown(text: string, originalName?: string): boolean {
  if (originalName && /\.(md|markdown)$/i.test(originalName)) return true;
  return /^#{1,6}\s/m.test(text) || /\*\*[^*]+\*\*/.test(text) || /^\s*[-*]\s+\S/m.test(text);
}

/** Tipo pelo conteúdo (magic bytes), nunca pela extensão (F01 §2.7). */
export function detectFileType(buffer: Uint8Array, originalName?: string): DetectedType {
  const head = Buffer.from(buffer.subarray(0, 8)).toString("latin1");
  if (head.startsWith("%PDF-")) return { kind: "pdf", mime: MIME.pdf };
  if (head.startsWith("PK\x03\x04")) {
    const asLatin = Buffer.from(buffer).toString("latin1");
    return asLatin.includes("word/")
      ? { kind: "docx", mime: MIME.docx }
      : { kind: "unknown", mime: MIME.unknown };
  }
  const sample = buffer.subarray(0, 8192);
  if (sample.includes(0)) return { kind: "unknown", mime: MIME.unknown };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return { kind: "unknown", mime: MIME.unknown };
  }
  return looksLikeMarkdown(text, originalName)
    ? { kind: "markdown", mime: MIME.markdown }
    : { kind: "text", mime: MIME.text };
}
