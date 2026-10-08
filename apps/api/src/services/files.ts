import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type DetectedLanguage,
  detectFileType,
  ExtractError,
  extractText,
  type FileKind,
  MAX_UPLOAD_BYTES,
  type Repos,
  type SourceFileRecord,
  validateFreeText,
} from "@narnia-jobs/core";

/** Metadados da leitura determinística feita no upload, cacheados ao lado do arquivo (`<sha>.meta.json`). */
export interface UploadMeta {
  kind: Exclude<FileKind, "unknown">;
  chars: number;
  pages: number | null;
  quality: number;
  language: DetectedLanguage;
  tooManyPages: boolean;
}

const EXT: Record<Exclude<FileKind, "unknown">, string> = {
  pdf: "pdf",
  docx: "docx",
  markdown: "md",
  text: "txt",
};

export interface StoredFile {
  file: SourceFileRecord;
  meta: UploadMeta;
  created: boolean;
}

function metaPath(dataDir: string, sha: string): string {
  return join(dataDir, "uploads", `${sha}.meta.json`);
}

export function readMeta(dataDir: string, file: SourceFileRecord): UploadMeta | null {
  const p = metaPath(dataDir, file.sha256);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as UploadMeta) : null;
}

/** Guarda um upload: tipo por magic bytes, texto extraído para validar e estimar, dedupe por sha256. */
export async function storeUpload(
  repos: Repos,
  dataDir: string,
  buffer: Uint8Array,
  originalName: string | null,
  kind: "cv" | "text",
): Promise<StoredFile> {
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new ExtractError("too_large", `Arquivo acima de ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`);
  }
  const detected = detectFileType(buffer, originalName ?? undefined);
  if (detected.kind === "unknown") {
    throw new ExtractError(
      "unsupported",
      "Tipo de arquivo não suportado (aceitos: PDF, DOCX, Markdown, texto)",
    );
  }
  const extracted = await extractText(buffer, originalName ? { originalName } : {});
  const sha = createHash("sha256").update(buffer).digest("hex");
  const existing = repos.sourceFiles.findBySha256(sha);
  const meta: UploadMeta = {
    kind: extracted.kind,
    chars: extracted.text.length,
    pages: extracted.pages ?? null,
    quality: extracted.quality,
    language: extracted.language,
    tooManyPages: extracted.tooManyPages ?? false,
  };
  if (existing)
    return { file: existing, meta: readMeta(dataDir, existing) ?? meta, created: false };
  const rel = join("uploads", `${sha}.${EXT[extracted.kind]}`);
  mkdirSync(join(dataDir, "uploads"), { recursive: true });
  writeFileSync(join(dataDir, rel), buffer);
  writeFileSync(metaPath(dataDir, sha), JSON.stringify(meta));
  const file = repos.sourceFiles.insert({
    originalName,
    mime: detected.mime,
    size: buffer.byteLength,
    sha256: sha,
    path: rel,
    kind,
  });
  return { file, meta, created: true };
}

export async function storeText(repos: Repos, dataDir: string, text: string): Promise<StoredFile> {
  const normalized = validateFreeText(text);
  return storeUpload(repos, dataDir, Buffer.from(normalized, "utf8"), null, "text");
}

export function toFileResponse(file: SourceFileRecord, meta: UploadMeta | null) {
  return {
    id: file.id,
    kind: file.kind,
    originalName: file.originalName,
    mime: file.mime,
    size: file.size,
    pages: meta?.pages ?? null,
    uploadedAt: file.uploadedAt,
  };
}
