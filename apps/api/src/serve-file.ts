import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import type { Context } from "hono";

/** `Range: bytes=a-b` (um intervalo só) sobre um arquivo de `size` bytes; null = arquivo inteiro. */
export function rangeOf(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header) : null;
  if (!m || (!m[1] && !m[2])) return null;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : null;
}

/**
 * Serve um arquivo do disco com `Range` (206), para o `<video>` do navegador buscar trechos (F07 anexos, F13 vídeo da
 * entrevista). `headers` completa os cabeçalhos (tipo, disposição, cache).
 */
export function serveFile(c: Context, path: string, headers: Record<string, string>) {
  const size = statSync(path).size;
  const range = rangeOf(c.req.header("range"), size);
  const out: Record<string, string> = {
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
    ...headers,
  };
  const stream = (start: number, end: number) =>
    Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
  if (range) {
    out["content-range"] = `bytes ${range.start}-${range.end}/${size}`;
    out["content-length"] = String(range.end - range.start + 1);
    return c.body(stream(range.start, range.end), 206, out);
  }
  out["content-length"] = String(size);
  return c.body(stream(0, Math.max(0, size - 1)), 200, out);
}
