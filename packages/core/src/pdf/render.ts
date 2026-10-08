import { execFile } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Exec = (cmd: string, args: string[]) => Promise<unknown>;

const defaultExec: Exec = (cmd, args) => run(cmd, args);

export async function hasPdftoppm(exec: Exec = defaultExec): Promise<boolean> {
  try {
    await exec("pdftoppm", ["-v"]);
    return true;
  } catch {
    return false;
  }
}

/** Renderiza páginas em PNG com `pdftoppm` (poppler; decisão F01-25). Devolve os caminhos em ordem de página. */
export async function renderPdfPages(
  pdfPath: string,
  outDir: string,
  opts: { dpi?: number; exec?: Exec } = {},
): Promise<string[]> {
  const exec = opts.exec ?? defaultExec;
  const prefix = join(outDir, "page");
  await exec("pdftoppm", ["-r", String(opts.dpi ?? 150), "-png", pdfPath, prefix]);
  return readdirSync(outDir)
    .filter((f) => /^page-\d+\.png$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))
    .map((f) => join(outDir, f));
}
